import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import { ROLE_LABEL, homeOf } from '@/lib/permissions';

export default async function Forbidden() {
  const u = await currentUser();
  if (!u) redirect('/login');
  const home = homeOf(u.role);
  return (
    <div className="panel empty" style={{ maxWidth: 520 }}>
      <h2 style={{ marginTop: 0 }}>ไม่มีสิทธิ์เข้าถึงหน้านี้</h2>
      <p>บัญชี {u.displayName} ({ROLE_LABEL[u.role]}) ไม่มีสิทธิ์ใช้งานส่วนนี้ หากจำเป็นกรุณาติดต่อผู้ดูแลระบบ</p>
      {home !== '/forbidden' && <Link className="btn" href={home}>กลับหน้าหลัก</Link>}
    </div>
  );
}
