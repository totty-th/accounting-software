import Link from 'next/link';
import { getDb } from '@/lib/db';
import { money, dateTh, partyName } from '@/lib/format';
import { Pill } from '@/components/Pill';
import { Group } from '@/components/Board';
import { ActionButton } from '@/components/ActionButton';
import * as A from '@/lib/actions';

export default async function Expenses() {
  const db = await getDb();
  const rows = await db.q(`select e.*, c.business_name, c.contact_name,
      (select string_agg(description, ', ' order by line_no) from expense_lines l where l.expense_id=e.id) items
    from expenses e join contacts c on c.id=e.contact_id order by e.exp_date desc, e.exp_no desc`);
  const sets: [string, string, string][] = [['pending', 'รอดำเนินการ', 'var(--orange)'], ['approved', 'อนุมัติแล้ว', 'var(--blue)'],
    ['paid', 'ชำระแล้ว', 'var(--green)'], ['cancelled', 'ยกเลิก', 'var(--grey)']];
  return (
    <>
      <div className="top"><div><h1>ค่าใช้จ่าย</h1><p className="sub">บันทึกแล้วตั้งเจ้าหนี้ทันที จ่ายเงินแล้วออกหนังสือรับรองหัก ณ ที่จ่ายให้อัตโนมัติ</p></div>
        <Link className="btn" href="/expenses/new">+ ค่าใช้จ่ายใหม่</Link></div>
      {rows.length === 0 && <div className="panel empty">ยังไม่มีค่าใช้จ่าย</div>}
      {sets.map(([s, title, color]) => {
        const rs = rows.filter(r => r.status === s); if (!rs.length) return null;
        return (
          <Group key={s} title={title} color={color} count={rs.length}>
            <table><thead><tr><th>เลขที่</th><th>ผู้ขาย</th><th>รายการ</th><th>วันที่</th><th className="num">ยอดรวม</th><th className="num">หัก ณ ที่จ่าย</th><th>สถานะ</th><th /></tr></thead>
              <tbody>{rs.map(r => (
                <tr key={r.id}><td className="no">{r.exp_no}</td><td>{partyName(r)}</td><td>{r.items}</td><td>{dateTh(r.exp_date)}</td>
                  <td className="num">{money(r.total)}</td><td className="num">{Number(r.wht_total) ? money(r.wht_total) : '-'}</td><td><Pill s={r.status} /></td>
                  <td><div className="acts">
                    {r.status === 'pending' && <ActionButton label="อนุมัติ" variant="ghost" action={A.approveExpense.bind(null, r.id)} />}
                    {(r.status === 'pending' || r.status === 'approved') && <ActionButton label="จ่ายเงิน" action={A.payExpense.bind(null, r.id)} />}
                    {(r.status === 'approved' || r.status === 'paid') && <ActionButton label="รีเซ็ต" variant="ghost" action={A.resetExpense.bind(null, r.id)} />}
                    {r.status !== 'cancelled' && <ActionButton label="ยกเลิก" variant="danger" confirmText="c" action={A.cancelExpense.bind(null, r.id)} />}
                  </div></td></tr>))}</tbody></table>
          </Group>);
      })}
    </>
  );
}
