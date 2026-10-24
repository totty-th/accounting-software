import { redirect } from 'next/navigation';
import { currentUser, homeOf } from '@/lib/auth';
import { authMode } from '@/lib/session';
import { LoginForm } from '@/components/LoginForm';

export default async function Login() {
  const u = await currentUser();
  if (u) redirect(homeOf(u.role));
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 16 }}>
      <div className="panel" style={{ width: 'min(380px, 100%)', maxWidth: 'none' }}>
        <div className="brand" style={{ marginBottom: 14 }}><span className="logo">฿</span>ระบบบัญชี</div>
        <h2 style={{ margin: '0 0 12px' }}>เข้าสู่ระบบ</h2>
        <LoginForm demo={authMode() === 'demo'} />
      </div>
    </div>
  );
}
