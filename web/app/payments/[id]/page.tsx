import { notFound } from 'next/navigation';
import { can } from '@/lib/permissions';
import { requirePage } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { money, dateTh, dateIso, partyName } from '@/lib/format';
import { PayForm } from '@/components/PayForm';
import { PurchaseDocTools } from '@/components/PurchaseDocTools';
import { SlipStatus } from '@/components/SlipStatus';
import { SLIP_TH, SLIP_COLOR } from '@/lib/slip-state';
import { SlipEdit } from '@/components/SlipEdit';
import { slipRows } from '@/lib/payment-slips';
import * as A from '@/lib/actions';

export const dynamic = 'force-dynamic';
const METHOD: Record<string, string> = { cash: 'เงินสด', transfer: 'โอนเงิน', card: 'บัตรเครดิต', cheque: 'เช็ค', petty: 'เงินสดย่อย' };

// หน้ารายละเอียด/แก้ไขใบเตรียมจ่าย: ข้อมูลหัวเอกสาร · รายการเอกสาร · ยอดรวม · ชำระเงินต่อผู้จำหน่าย · บันทึกการชำระเงิน
export default async function SlipPage({ params }: { params: { id: string } }) {
  const user = await requirePage('expenses.read');
  const W = can(user.role, 'expenses.write');
  const db = await getDb();
  const { rows, items } = await slipRows(db);
  const s = rows.find(r => r.id === params.id); if (!s) notFound();
  const h = (await db.q<any>('select * from payment_slips where id=$1', [s.id]))[0];
  const its = items.filter(i => i.slip_id === s.id);
  const byVendor = [...new Set(its.map(i => i.contact_id as string))].map(cid => {
    const mine = its.filter(i => i.contact_id === cid);
    return { cid, name: partyName(mine[0]), net: mine.filter(i => !i.paid).reduce((a, i) => a + Number(i.net), 0), paid: mine.every(i => i.paid) };
  });
  const pays = await db.q<any>(`select p.*, i.doc_no from purchase_payments p join payment_slip_items x on x.doc_type=p.doc_type and x.doc_id=p.doc_id
      cross join lateral slip_doc_info(x.doc_type, x.doc_id) i
      where x.slip_id=$1 order by x.line_no, p.line_no`, [s.id]);
  const banks = (await db.q(`select id, bank_name, account_no from bank_accounts where is_active order by bank_name`)).map(b => ({ id: b.id as string, label: `${b.bank_name} ${b.account_no}` }));
  const cards = (await db.q(`select id, card_name, last4 from credit_cards where is_active order by card_name`)).map(c => ({ id: c.id as string, label: `${c.card_name} ****${c.last4}` }));
  const petties = (await db.q(`select id, fund_name from petty_funds where is_active order by fund_name`)).map(f => ({ id: f.id as string, label: f.fund_name as string }));
  const editable = W && s.status === 'active';
  return (
    <>
      <div className="top"><div>
        <h1>{editable ? 'แก้ไขใบเตรียมจ่าย/ใบสำคัญจ่าย' : 'ใบเตรียมจ่าย/ใบสำคัญจ่าย'} <span className="no">{s.pay_no}</span></h1>
        <p className="sub"><a href="/payments">← กลับรายการ</a> · วันที่ {dateTh(s.pay_date)} · ผู้จ่าย {s.vendors.join(', ')}</p></div>
        <div className="acts" style={{ gap: 8 }}><SlipStatus id={s.id} state={s.state} canWrite={W} /></div></div>
      <div className="panel" id="share"><div className="acts" style={{ justifyContent: 'space-between' }}>
        <div><span className="sub">จำนวนเงินรวมทั้งสิ้น</span><div style={{ fontSize: 24, color: SLIP_COLOR[s.state] }}>{money(s.gross)}</div><span className="sub">{SLIP_TH[s.state]}</span></div>
        <PurchaseDocTools kind="PAY" id={s.id} token={h.share_token ?? null} canWrite={W} /></div></div>
      <SlipEdit id={s.id} disabled={!editable}
        init={{ due: h.due_date ? dateIso(h.due_date) : '', preparer: h.preparer ?? '', requester: h.requester ?? '', approver: h.approver ?? '', reason: h.reason ?? '', note: h.note ?? '', internal: h.internal_note ?? '' }} />
      <div className="panel"><table>
        <thead><tr><th>ลำดับ</th><th>วันที่เอกสาร</th><th>เลขที่เอกสาร</th><th>ผู้จำหน่าย</th><th>วันครบกำหนด</th><th className="num">ยอดรวมสุทธิ</th><th className="num">หัก ณ ที่จ่าย</th><th className="num">ยอดจ่าย</th><th>สถานะ</th></tr></thead>
        <tbody>{its.map((i, k) => (
          <tr key={i.doc_id}><td>{k + 1}</td><td>{dateTh(i.doc_date)}</td>
            <td className="no"><a href={i.doc_type === 'EXP' ? `/expenses/${i.doc_id}` : `/purchases/ri/${i.doc_id}`}>{i.doc_no}</a></td>
            <td>{partyName(i)}</td><td>{i.due_date ? dateTh(i.due_date) : '-'}</td>
            <td className="num">{money(i.gross)}</td><td className="num">{Number(i.wht) ? money(i.wht) : '-'}</td><td className="num">{money(i.net)}</td>
            <td>{i.paid ? 'ชำระเงินแล้ว' : 'ค้างจ่าย'}</td></tr>))}</tbody>
        <tfoot><tr><td colSpan={5}>รวมรายการ {s.docs} รายการ</td><td className="num">{money(s.gross)}</td><td className="num">{money(s.wht)}</td><td className="num"><b>{money(s.net)}</b></td><td /></tr></tfoot></table></div>
      <div className="panel" id="pay"><h3>บันทึกการชำระเงิน</h3>
        {pays.length > 0 && <table><thead><tr><th>วันที่ชำระ</th><th>เอกสาร</th><th>ช่องทางชำระ</th><th className="num">ยอดชำระ</th></tr></thead>
          <tbody>{pays.map((p, k) => <tr key={k}><td>{dateTh(p.pay_date)}</td><td className="no">{p.doc_no}</td><td>{METHOD[p.method] ?? p.method}</td><td className="num">{money(p.amount)}</td></tr>)}</tbody></table>}
        {pays.length === 0 && its.some(i => i.paid) && <p className="sub">จ่ายเงินสดเต็มจำนวน (ไม่ได้ระบุช่องทาง)</p>}
        {editable && byVendor.filter(v => !v.paid).map(v => (
          <details key={v.cid} open={byVendor.length === 1}><summary className="btn sm">เพิ่มการชำระเงิน {v.name} ({money(v.net)})</summary>
            <PayForm net={v.net} banks={banks} cards={cards} petties={petties} onPay={A.payPaymentSlipVendor.bind(null, s.id, v.cid)} /></details>))}
        {byVendor.every(v => v.paid) && <p className="sub">จ่ายครบทุกเอกสารแล้ว · ต้องการแก้ไขให้ "รีเซ็ต" แล้วจ่ายใหม่</p>}
      </div>
    </>
  );
}
