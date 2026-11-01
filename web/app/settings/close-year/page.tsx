import Link from 'next/link';
import { requirePage } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { getDb } from '@/lib/db';
import { money, dateTh } from '@/lib/format';
import { STATUS_TH } from '@/lib/closing';

export const dynamic = 'force-dynamic';
/** ปิดงบบัญชีรายได้และค่าใช้จ่าย: รายการเอกสารปิดบัญชี (วันที่ · เลขที่ · รอบ · รวมรายได้ · รวมค่าใช้จ่าย · สถานะ) · สร้างใหม่เลือกรอบเป็นเดือน/ปี/ช่วงวันที่ได้ */
export default async function CloseList({ searchParams }: { searchParams: { st?: string } }) {
  const user = await requirePage('reports.read');
  const db = await getDb();
  const st = ['pending', 'approved'].includes(searchParams.st ?? '') ? searchParams.st! : '';
  const rows = await db.q<any>(`select id, doc_no, closing_date::text d, period_from::text f, period_to::text t, total_revenue::float8 rev, total_expense::float8 exp, status from period_closings
    where deleted_at is null and ($1 = '' or status = $1) order by closing_date desc, doc_no desc`, [st]);
  const canW = can(user.role, 'accounts.write');
  return (
    <>
      <div className="top"><div><h1>ปิดบัญชีรายได้และค่าใช้จ่าย</h1>
        <p className="sub">โอนรายได้และค่าใช้จ่ายของรอบที่เลือก (เดือน ปี หรือช่วงวันที่ใดก็ได้ ปิดได้หลายครั้งต่อปี) เข้าบัญชีทุน ด้วยใบสำคัญ CP · รอบห้ามทับกับเอกสารที่ยังไม่ลบ · การปิดบัญชีไม่ใช่การล็อกงวด (ล็อกงวดที่ <Link href="/settings/lock">ตั้งค่า &gt; ล็อกงวดบัญชี</Link>)</p></div>
        {canW && <Link className="btn" href="/settings/close-year/new">สร้างใหม่</Link>}</div>
      <form className="row-inline" method="get">
        <label className="f">สถานะ<select name="st" defaultValue={st}><option value="">ทั้งหมด</option><option value="pending">รอดำเนินการ</option><option value="approved">อนุมัติแล้ว</option></select></label>
        <button className="btn ghost">แสดงผล</button></form>
      <div className="panel" style={{ padding: 0, overflowX: 'auto' }}>
        <table><thead><tr><th>วันที่</th><th>เลขที่เอกสาร</th><th>รอบปิดบัญชี</th><th className="num">รวมรายได้</th><th className="num">รวมค่าใช้จ่าย</th><th>สถานะ</th><th /></tr></thead>
          <tbody>{rows.map(r => <tr key={r.id}><td>{dateTh(r.d)}</td>
            <td className="no"><Link href={`/settings/close-year/${r.id}`}>{r.doc_no}</Link></td>
            <td>{dateTh(r.f)} - {dateTh(r.t)}</td>
            <td className="num">{money(r.rev)}</td><td className="num">{money(r.exp)}</td>
            <td><span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 12, background: r.status === 'approved' ? '#d9f6e6' : '#ffe9c7', color: r.status === 'approved' ? '#037f4c' : '#a8610a' }}>{STATUS_TH[r.status]}</span></td>
            <td><a className="btn sm ghost" href={`/settings/close-year/${r.id}/xlsx`}>⬇ ดาวน์โหลด</a></td></tr>)}
            {rows.length === 0 && <tr><td colSpan={7} className="empty">ยังไม่มีเอกสารปิดบัญชี</td></tr>}</tbody></table>
      </div>
    </>
  );
}
