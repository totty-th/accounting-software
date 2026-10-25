import { getDb, today } from '@/lib/db';
import { money, dateTh, partyName } from '@/lib/format';
import { periodRange } from '@/lib/period';
import { reportPeriod, pgArr } from '@/lib/report-filter';
import { ReportFilter } from '@/components/ReportFilter';
import { PayGroups, type PayGroup } from '@/components/PayGroups';
import { requirePage } from '@/lib/auth';
import { ReportTools } from '@/components/ReportTools';

export const dynamic = 'force-dynamic';
type Sp = { period?: string; from?: string; to?: string; ch?: string | string[] };
// รายงานการชำระเงิน (ค่าใช้จ่าย/ซื้อสินค้า): จัดกลุ่มตามช่องทางที่จ่ายจริง (เงินสด / โอน / บัตรเครดิต / เงินสดย่อย / เช็ค) กรองตามวันที่ชำระ
// ไม่นับเอกสารที่ยกเลิก · ยอดรวมสุทธิ = ยอดจ่ายสุทธิของเอกสาร (หลังหัก ณ ที่จ่าย) · ยอดชำระ = เงินที่จ่ายผ่านช่องทางนั้น
const CH = `case pp.method when 'cash' then 'cash' when 'transfer' then 'transfer:' || pp.bank_account_id when 'card' then 'card:' || pp.credit_card_id
  when 'petty' then 'petty:' || pp.petty_fund_id when 'cheque' then 'cheque:' || pp.bank_account_id end`;
const LABEL = `case pp.method when 'cash' then 'เงินสด' when 'transfer' then 'โอน ' || coalesce(ba.bank_name || ' ' || ba.account_no, '')
  when 'card' then 'บัตรเครดิต ' || coalesce(cc.card_name || ' ****' || cc.last4, '') when 'petty' then 'เงินสดย่อย ' || coalesce(pf.fund_name, '')
  when 'cheque' then 'เช็ค ' || coalesce(ba.bank_name || ' ' || ba.account_no, '') end`;
const FROM = `from purchase_payments pp
  left join bank_accounts ba on ba.id = pp.bank_account_id left join credit_cards cc on cc.id = pp.credit_card_id left join petty_funds pf on pf.id = pp.petty_fund_id
  join lateral (select e.exp_no no, e.exp_date dt, e.contact_id, e.total - e.wht_total net, e.status from expenses e where pp.doc_type = 'EXP' and e.id = pp.doc_id
                union all select g.ri_no, g.ri_date, g.contact_id, g.total, g.status from goods_receipts g where pp.doc_type = 'RI' and g.id = pp.doc_id) d on d.status <> 'cancelled'
  join contacts c on c.id = d.contact_id`;

export default async function PaymentReport({ searchParams }: { searchParams: Sp }) {
  await requirePage('reports.read');
  const period = reportPeriod(searchParams.period);
  const range = periodRange(period, today(), searchParams.from, searchParams.to);
  const db = await getDb();
  const all = await db.q<any>(`select distinct ${CH} key, ${LABEL} label ${FROM} order by 2`);
  const chOpts = all.map(x => [x.key, x.label] as [string, string]);
  const sel = ([] as string[]).concat(searchParams.ch ?? []).filter(k => chOpts.some(o => o[0] === k));
  const rows = await db.q<any>(`select pp.doc_type, pp.doc_id, pp.line_no, pp.method, pp.pay_date, pp.amount, pp.cheque_no, ${CH} key, ${LABEL} label,
      d.no, d.dt, d.net, c.business_name, c.contact_name ${FROM}
    where ($1::date is null or pp.pay_date >= $1::date) and ($2::date is null or pp.pay_date <= $2::date)
      and (cardinality($3::text[]) = 0 or ${CH} = any($3::text[])) order by 9, pp.pay_date, d.no`, [range?.[0] ?? null, range?.[1] ?? null, pgArr(sel)]);
  const groups = new Map<string, PayGroup>();
  for (const r of rows) {
    const g: PayGroup = groups.get(r.key) ?? { key: r.key, label: r.label, net: 0, paid: 0, rows: [] };
    g.net += Number(r.net); g.paid += Number(r.amount);
    g.rows.push({ key: `${r.doc_id}:${r.line_no}`, href: r.doc_type === 'RI' ? `/purchases/ri/${r.doc_id}` : `/expenses/${r.doc_id}`, no: r.no, date: dateTh(r.dt), party: partyName(r),
      payDate: dateTh(r.pay_date), detail: r.method === 'cheque' ? `เช็คเลขที่ ${r.cheque_no ?? '-'}` : r.label, net: Number(r.net), paid: Number(r.amount) });
    groups.set(r.key, g);
  }
  const docs = new Map<string, number>(); rows.forEach(r => docs.set(`${r.doc_type}:${r.doc_id}`, Number(r.net)));
  const totNet = [...docs.values()].reduce((a, b) => a + b, 0), totPaid = rows.reduce((a, r) => a + Number(r.amount), 0);
  return (
    <>
      <div className="top"><div><h1>รายงานการชำระเงิน</h1><p className="sub">ค่าใช้จ่ายและใบรับสินค้าที่จ่ายแล้ว จัดกลุ่มตามช่องทาง · กรองตามวันที่ชำระ · ไม่รวมเอกสารที่ยกเลิก</p></div></div>
      <ReportFilter period={period} from={searchParams.from} to={searchParams.to} name="ch" allLabel="ช่องทางการชำระเงินทั้งหมด" groups={[{ label: '', options: chOpts }]} selected={sel} />
      <div className="panel">
        <div className="sub">ณ วันที่ {dateTh(today())} · ช่วงเวลา {range ? `${dateTh(range[0])} - ${dateTh(range[1])}` : 'ทั้งหมด'} · {docs.size} เอกสาร</div>
        <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', marginTop: 8 }}>
          <div><div className="sub">ยอดรวมทั้งสิ้น</div><strong>{money(totNet)}</strong></div>
          <div><div className="sub">ยอดชำระสุทธิ</div><strong>{money(totPaid)}</strong></div>
        </div>
      </div>
      <ReportTools exportBase="/reports/payments/export" title="รายงานการชำระเงิน" meta={[['ช่วงเวลา :', range ? `${dateTh(range[0])} - ${dateTh(range[1])}` : 'ทั้งหมด']]} />
      <div data-report className="panel" style={{ padding: 0, overflowX: 'auto', marginTop: 4 }}>
        {rows.length === 0 ? <div className="empty">ไม่มีข้อมูลในช่วงที่เลือก</div> : <PayGroups groups={[...groups.values()]} />}
      </div>
    </>
  );
}
