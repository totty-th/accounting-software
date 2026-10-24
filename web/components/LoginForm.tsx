'use client';
import { useFormState, useFormStatus } from 'react-dom';
import { loginAction } from '@/lib/auth-actions';

function Submit() {
  const { pending } = useFormStatus();
  return <button className="btn" type="submit" disabled={pending} style={{ width: '100%', justifyContent: 'center' }}>{pending ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบ'}</button>;
}
export function LoginForm({ demo }: { demo: boolean }) {
  const [st, act] = useFormState(loginAction, null);
  return (
    <form action={act} style={{ display: 'grid', gap: 12 }}>
      <label className="f">ชื่อผู้ใช้<input name="username" autoComplete="username" autoCapitalize="none" required autoFocus /></label>
      <label className="f">รหัสผ่าน<input name="password" type="password" autoComplete="current-password" required /></label>
      {st?.error && <div className="notice" role="alert" style={{ borderLeftColor: 'var(--red)' }}>{st.error}</div>}
      <Submit />
      {demo && <p className="sub" style={{ margin: 0 }}>โหมดเดโม: ทุกบัญชีใช้รหัสผ่านเดโมเดียวกัน (ไม่ใช่ระบบจริง)</p>}
    </form>
  );
}
