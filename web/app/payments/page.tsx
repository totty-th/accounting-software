import { can } from '@/lib/permissions';
import { requirePage } from '@/lib/auth';
import { getDb, today } from '@/lib/db';
import { money, dateTh, partyName } from '@/lib/format';
import { Group } from '@/components/Board';
import { ActionButton } from '@/components/ActionButton';
import { PayForm } from '@/components/PayForm';
import { SlipForm } from '@/components/SlipForm';
import * as A from '@/lib/actions';

export default async function Payments() {
  const user = await requirePage('expenses.read');
  const W = can(user.role, 'expenses.write');
  const db = await getDb();
  const slips = await db.q(`select * from payment_slips order by pay_date desc, pay_no desc`);
  const items = await db.q(`select x.slip_id, x.line_no, x.doc_type, x.doc_id, i.contact_id, i.doc_no, i.doc_date, i.due_date, i.gross, i.wht, i.net, i.paid,
      c.business_name, c.contact_name
    from payment_slip_items x cross join lateral slip_doc_info(x.doc_type, x.doc_id) i join contacts c on c.id=i.contact_id
    order by x.slip_id, x.line_no`);
  const open = (await db.q(`select 'EXP' t, e.id, e.exp_no no, e.due_date, e.total-e.wht_total net, c.business_name, c.contact_name
        from expenses e join contacts c on c.id=e.contact_id where e.status in ('pending','approved')
      union all select 'RI', g.id, g.ri_no, g.due_date, g.total, c.business_name, c.contact_name
        from goods_receipts g join contacts c on c.id=g.contact_id where g.status in ('unpaid','approved')`))
    .filter(d => !items.some(i => i.doc_id === d.id && slips.some(s => s.id === i.slip_id && s.status === 'active')))
    .map(d => ({ key: `${d.t}:${d.id}`, type: d.t as string, id: d.id as string, no: d.no as string, vendor: partyName(d), due: d.due_date ? dateTh(d.due_date) : '-', net: Number(d.net) }));
  const banks = (await db.q(`select id, bank_name, account_no from bank_accounts where is_active order by bank_name`))
    .map(b => ({ id: b.id as string, label: `${b.bank_name} ${b.account_no}` }));
  const cards = (await db.q(`select id, card_name, last4 from credit_cards where is_active order by card_name`))
    .map(c => ({ id: c.id as string, label: `${c.card_name} ****${c.last4}` }));
  const petties = (await db.q(`select id, fund_name from petty_funds where is_active order by fund_name`))
    .map(f => ({ id: f.id as string, label: f.fund_name as string }));
  const state = (s: any) => {
    if (s.status === 'cancelled') return 'cancelled';
    const its = items.filter(i => i.slip_id === s.id);
    return its.length && its.every(i => i.paid) ? 'paid' : 'pending';
  };
  const sets: [string, string, string][] = [['pending', 'รอดำเนินการ', 'var(--orange)'], ['paid', 'ชำระเงินแล้ว', 'var(--green)'], ['cancelled', 'ยกเลิก', 'var(--grey)']];
  return (
    <>
      <div className="top"><div><h1>ใบเตรียมจ่าย</h1>
        <p className="sub">รวมเอกสารค้างจ่ายหลายผู้จำหน่ายไว้จ่ายพร้อมกัน · ไม่ลงบัญชีเอง ลงที่ใบสำคัญจ่ายของแต่ละเอกสารตอนจ่าย</p></div></div>
      {W && <SlipForm docs={open} today={today()} />}
      {slips.length === 0 && <div className="panel empty">ยังไม่มีใบเตรียมจ่าย</div>}
      {sets.map(([st, title, color]) => {
        const ss = slips.filter(s => state(s) === st); if (!ss.length) return null;
        return (
          <Group key={st} title={title} color={color} count={ss.length}>
            {ss.map(s => {
              const its = items.filter(i => i.slip_id === s.id);
              const byVendor = [...new Set(its.map(i => i.contact_id as string))].map(cid => {
                const mine = its.filter(i => i.contact_id === cid);
                return { cid, name: partyName(mine[0]), docs: mine, net: mine.filter(i => !i.paid).reduce((a, i) => a + Number(i.net), 0), paid: mine.every(i => i.paid) };
              });
              return (
                <div key={s.id} className="panel" style={{ marginBottom: 8 }}>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
                    <b className="no">{s.pay_no}</b><span>{dateTh(s.pay_date)}</span>
                    <span className="sub">ชำระภายใน {s.due_date ? dateTh(s.due_date) : '-'} · ผู้จัดเตรียม {s.preparer ?? '-'} · ผู้ขอ {s.requester ?? '-'} · ผู้อนุมัติ {s.approver ?? '-'}{s.reason ? ` · ${s.reason}` : ''}</span>
                    <span style={{ flex: 1 }} />
                    {W && s.status === 'active' && <ActionButton label="ยกเลิก" variant="danger" confirmText="c" action={A.cancelPaymentSlip.bind(null, s.id)} />}
                  </div>
                  <p className="sub">{byVendor.length} ผู้จำหน่าย · {its.length} เอกสาร · รวม {money(its.reduce((a, i) => a + Number(i.net), 0))}</p>
                  <table><thead><tr><th>ผู้จำหน่าย</th><th>เอกสาร</th><th>ครบกำหนด</th><th className="num">ยอดตามเอกสาร</th><th className="num">หัก ณ ที่จ่าย</th><th className="num">ยอดจ่ายสุทธิ</th><th>สถานะ</th></tr></thead>
                    <tbody>{byVendor.map(v => v.docs.map((i, k) => (
                      <tr key={`${v.cid}${i.doc_id}`}><td>{k === 0 ? v.name : ''}</td><td className="no">{i.doc_no}</td><td>{i.due_date ? dateTh(i.due_date) : '-'}</td>
                        <td className="num">{money(i.gross)}</td><td className="num">{Number(i.wht) ? money(i.wht) : '-'}</td><td className="num">{money(i.net)}</td>
                        <td>{i.paid ? 'ชำระเงินแล้ว' : 'ค้างจ่าย'}</td></tr>)))}</tbody></table>
                  {W && s.status === 'active' && byVendor.filter(v => !v.paid).map(v => (
                    <details key={v.cid}><summary className="btn sm">จ่าย {v.name} ({money(v.net)})</summary>
                      <PayForm net={v.net} banks={banks} cards={cards} petties={petties} onPay={A.payPaymentSlipVendor.bind(null, s.id, v.cid)} /></details>))}
                </div>);
            })}
          </Group>);
      })}
    </>
  );
}
