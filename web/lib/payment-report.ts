import type { Db } from './db';
import { pgArr } from './report-filter';

// รายงานการชำระเงิน (ค่าใช้จ่าย/ใบรับสินค้า) — คิวรีกลางใช้ร่วมกันระหว่างหน้ารายงาน และเทสต์
// ยอดเอกสารสุทธิ (net) = ยอดเต็มของเอกสาร − ภาษีหัก ณ ที่จ่าย (EXP: wht_total · RI: wht_paid ที่หักตอนจ่ายผ่านใบเตรียมจ่าย)
export const CH = `case pp.method when 'cash' then 'cash' when 'transfer' then 'transfer:' || pp.bank_account_id when 'card' then 'card:' || pp.credit_card_id
  when 'petty' then 'petty:' || pp.petty_fund_id when 'cheque' then 'cheque:' || pp.bank_account_id end`;
export const LABEL = `case pp.method when 'cash' then 'เงินสด' when 'transfer' then 'โอน ' || coalesce(ba.bank_name || ' ' || ba.account_no, '')
  when 'card' then 'บัตรเครดิต ' || coalesce(cc.card_name || ' ****' || cc.last4, '') when 'petty' then 'เงินสดย่อย ' || coalesce(pf.fund_name, '')
  when 'cheque' then 'เช็ค ' || coalesce(ba.bank_name || ' ' || ba.account_no, '') end`;
export const FROM = `from purchase_payments pp
  left join bank_accounts ba on ba.id = pp.bank_account_id left join credit_cards cc on cc.id = pp.credit_card_id left join petty_funds pf on pf.id = pp.petty_fund_id
  join lateral (select e.exp_no no, e.exp_date dt, e.contact_id, e.total - e.wht_total net, e.status from expenses e where pp.doc_type = 'EXP' and e.id = pp.doc_id
                union all select g.ri_no, g.ri_date, g.contact_id, g.total - g.wht_paid, g.status from goods_receipts g where pp.doc_type = 'RI' and g.id = pp.doc_id) d on d.status <> 'cancelled'
  join contacts c on c.id = d.contact_id`;

export const channelOptions = (db: Db) => db.q<{ key: string; label: string }>(`select distinct ${CH} key, ${LABEL} label ${FROM} order by 2`);
export const paymentRows = (db: Db, range: [string, string] | null, sel: string[]) => db.q<any>(
  `select pp.doc_type, pp.doc_id, pp.line_no, pp.method, pp.pay_date, pp.amount, pp.cheque_no, ${CH} key, ${LABEL} label,
      d.no, d.dt, d.net, c.business_name, c.contact_name ${FROM}
    where ($1::date is null or pp.pay_date >= $1::date) and ($2::date is null or pp.pay_date <= $2::date)
      and (cardinality($3::text[]) = 0 or ${CH} = any($3::text[])) order by 9, pp.pay_date, d.no`,
  [range?.[0] ?? null, range?.[1] ?? null, pgArr(sel)]);

/** จัดกลุ่มตามช่องทาง: ยอดเอกสาร (net) นับครั้งเดียวต่อเอกสารในแต่ละกลุ่ม แม้จ่ายหลายงวดช่องทางเดียวกัน */
export function groupPayments(rows: any[]) {
  const groups = new Map<string, { key: string; label: string; net: number; paid: number; rows: any[]; docs: Set<string> }>();
  for (const r of rows) {
    const g = groups.get(r.key) ?? { key: r.key, label: r.label, net: 0, paid: 0, rows: [] as any[], docs: new Set<string>() };
    const dk = `${r.doc_type}:${r.doc_id}`;
    if (!g.docs.has(dk)) { g.docs.add(dk); g.net += Number(r.net); }
    g.paid += Number(r.amount); g.rows.push(r); groups.set(r.key, g);
  }
  const docs = new Map<string, number>(); rows.forEach(r => docs.set(`${r.doc_type}:${r.doc_id}`, Number(r.net)));
  return { groups: [...groups.values()], docCount: docs.size, totNet: [...docs.values()].reduce((a, b) => a + b, 0), totPaid: rows.reduce((a, r) => a + Number(r.amount), 0) };
}

/** แถวสำหรับไฟล์ Excel: ยอดเอกสารเต็ม (net) + หัก ณ ที่จ่าย (wht) + ยอดที่จ่ายแล้วทั้งเอกสาร (doc_paid) + เลขใบเตรียมจ่าย */
export const paymentExportRows = (db: Db, range: [string, string] | null, sel: string[]) => db.q<any>(
  `select pp.doc_type, pp.doc_id, pp.line_no, pp.method, pp.pay_date, pp.amount, pp.cheque_no, pp.cheque_date, ${LABEL} grp, ${CH} key,
      d.no, d.dt, d.net, d.wht, d.slip, c.business_name, c.contact_name,
      (select coalesce(sum(p2.amount), 0) from purchase_payments p2 where p2.doc_type = pp.doc_type and p2.doc_id = pp.doc_id) doc_paid
    from purchase_payments pp
      left join bank_accounts ba on ba.id = pp.bank_account_id left join credit_cards cc on cc.id = pp.credit_card_id left join petty_funds pf on pf.id = pp.petty_fund_id
      join lateral (select e.exp_no no, e.exp_date dt, e.contact_id, e.total net, e.wht_total wht, e.status,
                           (select s.pay_no from payment_slip_items x join payment_slips s on s.id = x.slip_id where s.status = 'active' and x.doc_id = e.id limit 1) slip
                      from expenses e where pp.doc_type = 'EXP' and e.id = pp.doc_id
                    union all select g.ri_no, g.ri_date, g.contact_id, g.total, g.wht_paid, g.status,
                           (select s.pay_no from payment_slip_items x join payment_slips s on s.id = x.slip_id where s.status = 'active' and x.doc_id = g.id limit 1)
                      from goods_receipts g where pp.doc_type = 'RI' and g.id = pp.doc_id) d on d.status <> 'cancelled'
      join contacts c on c.id = d.contact_id
    where ($1::date is null or pp.pay_date >= $1::date) and ($2::date is null or pp.pay_date <= $2::date)
      and (cardinality($3::text[]) = 0 or ${CH} = any($3::text[])) order by pp.method, 9, pp.pay_date, d.no`,
  [range?.[0] ?? null, range?.[1] ?? null, pgArr(sel)]);
