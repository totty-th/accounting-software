import { requirePage } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { getDb, today } from '@/lib/db';
import { LockForm } from '@/components/LockForm';
import { ActionButton } from '@/components/ActionButton';
import { releasePeriodLock } from '@/lib/actions';

export const dynamic = 'force-dynamic';
export default async function Lock() {
  const user = await requirePage('reports.read');
  const db = await getDb();
  const rows = await db.q<any>(`select id, date_from::text f, date_to::text t, reason, created_at::text c, released_at::text r from period_locks order by created_at desc`);
  const y = new Date(today() + 'T00:00:00Z'); y.setUTCDate(y.getUTCDate() - 1);
  const canW = can(user.role, 'accounts.write');
  return (
    <>
      <div className="top"><div><h1>ล็อกงวดบัญชี</h1><p className="sub">งวดที่ล็อกแล้วลงรายการย้อนหลังไม่ได้ · ปลดล็อกได้ (เก็บประวัติไว้)</p></div></div>
      {canW && <LockForm maxTo={y.toISOString().slice(0, 10)} />}
      <div className="panel" style={{ padding: 0, overflowX: 'auto' }}>
        <table><thead><tr><th>ช่วงที่ล็อก</th><th>เหตุผล</th><th>ล็อกเมื่อ</th><th>สถานะ</th><th /></tr></thead>
          <tbody>{rows.map(l => <tr key={l.id}><td>{l.f} ถึง {l.t}</td><td>{l.reason}</td><td>{l.c.slice(0, 16)}</td>
            <td>{l.r ? `ปลดล็อกแล้ว ${l.r.slice(0, 16)}` : 'ล็อกอยู่'}</td>
            <td>{canW && !l.r && <ActionButton action={releasePeriodLock.bind(null, l.id)} label="ปลดล็อก" variant="ghost" confirmText="ปลดล็อกงวดนี้?" />}</td></tr>)}
            {rows.length === 0 && <tr><td colSpan={5} className="empty">ยังไม่เคยล็อกงวด</td></tr>}</tbody></table>
      </div>
    </>
  );
}
