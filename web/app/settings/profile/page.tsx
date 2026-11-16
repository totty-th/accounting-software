import { currentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getDb } from '@/lib/db';
import { ROLE_LABEL, PERMS, permsOf } from '@/lib/permissions';
import { ProfileForm } from '@/components/ProfileForm';
import { PERM_LABEL } from '@/lib/perm-labels';

export const dynamic = 'force-dynamic';
export default async function Profile() {
  const u = await currentUser(); if (!u) redirect('/login');
  const r = (await (await getDb()).q<any>('select username, first_name, last_name, phone, email from app_users where id=$1', [u.id]))[0] ?? {};
  const mine = permsOf(u.role);
  return (
    <>
      <div className="top"><div><h1>ข้อมูลส่วนตัว</h1><p className="sub">ชื่อผู้ใช้ {r.username} · ตำแหน่ง {ROLE_LABEL[u.role]}{r.email ? ` · ${r.email}` : ''} (ตำแหน่งและอีเมลเปลี่ยนได้โดยผู้ดูแลระบบ)</p></div></div>
      <ProfileForm first={r.first_name ?? ''} last={r.last_name ?? ''} phone={r.phone ?? ''} />
      <div className="panel" style={{ maxWidth: 520, marginTop: 16 }}>
        <h3 style={{ marginTop: 0 }}>ลายเซ็น</h3>
        <p className="sub">ใช้บนเอกสารขายที่คุณเป็นผู้สร้าง · <Link href="/settings/my-signature">จัดการลายเซ็นของฉัน</Link></p>
      </div>
      <details className="panel" style={{ maxWidth: 520, marginTop: 16 }}>
        <summary>สิทธิ์ของฉัน ({mine.length} รายการ)</summary>
        <ul>{PERMS.filter(p => mine.includes(p)).map(p => <li key={p}>{PERM_LABEL[p] ?? p}</li>)}</ul>
      </details>
    </>
  );
}
