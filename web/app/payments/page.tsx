import { can } from '@/lib/permissions';
import { requirePage } from '@/lib/auth';
import { getDb, today } from '@/lib/db';
import { money, dateTh, partyName } from '@/lib/format';
import { SlipForm } from '@/components/SlipForm';
import { SlipStatus, SlipDelete } from '@/components/SlipStatus';
import { SLIP_TH, type SlipState } from '@/lib/slip-state';
import { slipRows } from '@/lib/payment-slips';

const DOT: Record<SlipState, string> = { pending: 'var(--grey)', paid: 'var(--green)', received: 'var(--blue, #2980b9)', cancelled: 'var(--red, #c0392b)' };

// หน้ารายการใบเตรียมจ่าย/ใบสำคัญจ่าย แบบตารางเดียวตามต้นแบบ (REA 01-11-2026)
export default async function Payments({ searchParams }: { searchParams: { q?: string; st?: string } }) {
  const user = await requirePage('expenses.read');
  const W = can(user.role, 'expenses.write');
  const db = await getDb();
  const { rows: all, items } = await slipRows(db);
  const q = (searchParams.q ?? '').trim().toLowerCase(); const st = searchParams.st ?? '';
  const rows = all.filter(r => (!st || r.state === st) && (!q || r.pay_no.toLowerCase().includes(q) || r.vendors.some(v => v.toLowerCase().includes(q))
    || items.some(i => i.slip_id === r.id && String(i.doc_no).toLowerCase().includes(q))));
  const open = (await db.q(`select 'EXP' t, e.id, e.exp_no no, e.due_date, e.total-e.wht_total net, c.business_name, c.contact_name
        from expenses e join contacts c on c.id=e.contact_id where e.status in ('pending','approved')
      union all select 'RI', g.id, g.ri_no, g.due_date, g.total, c.business_name, c.contact_name
        from goods_receipts g join contacts c on c.id=g.contact_id where g.status in ('unpaid','approved')`))
    .filter(d => !items.some(i => i.doc_id === d.id && all.some(s => s.id === i.slip_id && s.status === 'active')))
    .map(d => ({ key: `${d.t}:${d.id}`, type: d.t as string, id: d.id as string, no: d.no as string, vendor: partyName(d), due: d.due_date ? dateTh(d.due_date) : '-', net: Number(d.net) }));
  const total = rows.filter(r => r.state !== 'cancelled').reduce((a, r) => a + r.net, 0);
  return (
    <>
      <div className="top"><div><h1>ใบเตรียมจ่าย/ใบสำคัญจ่าย</h1>
        <p className="sub">รวมเอกสารค้างจ่ายหลายผู้จำหน่ายไว้จ่ายพร้อมกัน · ไม่ลงบัญชีเอง ลงที่ใบสำคัญจ่ายของแต่ละเอกสารตอนจ่าย</p></div></div>
      {W && <SlipForm docs={open} today={today()} />}
      <form method="get" className="acts" style={{ justifyContent: 'flex-start', gap: 8, margin: '8px 0' }}>
        <select name="st" defaultValue={st} aria-label="สถานะ" style={{ width: 'auto' }}>
          <option value="">สถานะทั้งหมด</option>{(Object.keys(SLIP_TH) as SlipState[]).map(k => <option key={k} value={k}>{SLIP_TH[k]}</option>)}</select>
        <input name="q" defaultValue={searchParams.q ?? ''} placeholder="ค้นหา เลขที่ / ผู้จำหน่าย / เอกสาร" style={{ maxWidth: 280 }} />
        <button className="btn sm">ค้นหา</button>
      </form>
      {rows.length === 0 ? <div className="panel empty">ไม่พบใบเตรียมจ่าย</div> : (
        <div className="panel"><table>
          <thead><tr><th>ชำระก่อนวันที่</th><th>เลขที่เอกสาร</th><th>ผู้จำหน่าย</th><th className="num">ยอดจ่ายสุทธิ</th><th>สถานะ</th><th /></tr></thead>
          <tbody>{rows.map(r => (
            <tr key={r.id} style={r.state === 'cancelled' ? { opacity: 0.5 } : undefined}>
              <td>{r.due_date ? dateTh(r.due_date) : dateTh(r.pay_date)}</td>
              <td className="no"><span style={{ color: DOT[r.state] }}>●</span> <a href={`/payments/${r.id}`}>{r.pay_no}</a></td>
              <td>{r.vendors.join(', ')}<div className="sub">{r.docs} เอกสาร</div></td>
              <td className="num">{money(r.net)}{r.wht > 0 && <div className="sub" title={`ยอดตามเอกสาร ${money(r.gross)} · หัก ณ ที่จ่าย ${money(r.wht)}`}>ⓘ หัก {money(r.wht)}</div>}</td>
              <td><SlipStatus id={r.id} state={r.state} canWrite={W} /></td>
              <td className="noprint"><details style={{ position: 'relative' }}><summary className="btn sm ghost" style={{ listStyle: 'none', cursor: 'pointer' }}>⋯</summary>
                <div className="panel" style={{ position: 'absolute', right: 0, zIndex: 5, minWidth: 170, padding: 6, display: 'grid', gap: 4 }}>
                  <a className="btn sm ghost" href={`/payments/${r.id}`}>{W && r.state !== 'cancelled' ? 'แก้ไข' : 'ดู'}</a>
                  <a className="btn sm ghost" href={`/purchases/pay/${r.id}/pdf`} target="_blank">พิมพ์ / PDF</a>
                  <a className="btn sm ghost" href={`/purchases/pay/${r.id}/pdf?download=1`}>ดาวน์โหลด</a>
                  <a className="btn sm ghost" href={`/payments/${r.id}#share`}>แชร์</a>
                  {W && (r.state === 'pending' || r.state === 'cancelled') && <SlipDelete id={r.id} />}
                </div></details></td></tr>))}</tbody></table>
          <p className="sub" style={{ marginTop: 8 }}>{rows.length} ใบ · ยอดจ่ายสุทธิรวม (ไม่รวมที่ยกเลิก) {money(total)}</p></div>)}
    </>
  );
}
