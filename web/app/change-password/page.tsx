import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import { ChangePasswordForm } from '@/components/LoginForm';
import { authMode } from '@/lib/session';
import { getDb } from '@/lib/db';

export default async function ChangePassword() {
  const u = await currentUser({ allowMustChange: true });
  if (!u) redirect('/login');
  const has = (await (await getDb()).q('select password_hash is not null as h from app_users where id=$1', [u.id]))[0]?.h;
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 16 }}>
      <div className="panel" style={{ width: 'min(400px, 100%)', maxWidth: 'none' }}>
        <h2 style={{ margin: '0 0 12px' }}>เปลี่ยนรหัสผ่าน</h2>
        {has ? <ChangePasswordForm forced={u.mustChange} />
          : <p className="sub">{authMode() === 'demo' ? 'บัญชีเดโมนี้ยังไม่มีรหัสของตัวเอง ให้ผู้ดูแลตั้งรหัสให้ก่อน' : 'บัญชีนี้ยังไม่มีรหัสผ่าน'}</p>}
        {!u.mustChange && <p style={{ margin: '12px 0 0' }}><a href="/">← กลับ</a></p>}
      </div>
    </div>
  );
}
