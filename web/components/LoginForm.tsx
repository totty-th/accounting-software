'use client';
import { useFormState, useFormStatus } from 'react-dom';
import { loginAction, changePasswordAction, setupAction } from '@/lib/auth-actions';

function Submit({ label, busy }: { label: string; busy: string }) {
  const { pending } = useFormStatus();
  return <button className="btn" type="submit" disabled={pending} style={{ width: '100%', justifyContent: 'center' }}>{pending ? busy : label}</button>;
}
const Err = ({ e }: { e?: string }) => e ? <div className="notice" role="alert" style={{ borderLeftColor: 'var(--red)' }}>{e}</div> : null;

export function LoginForm({ demo }: { demo: boolean }) {
  const [st, act] = useFormState(loginAction, null);
  return (
    <form action={act} style={{ display: 'grid', gap: 12 }}>
      <label className="f">{demo ? 'อีเมลหรือชื่อผู้ใช้' : 'อีเมล'}<input name="email" type={demo ? 'text' : 'email'} autoComplete="username" autoCapitalize="none" required autoFocus /></label>
      <label className="f">รหัสผ่าน<input name="password" type="password" autoComplete="current-password" required /></label>
      <Err e={st?.error} />
      <Submit label="เข้าสู่ระบบ" busy="กำลังเข้าสู่ระบบ..." />
      {demo
        ? <p className="sub" style={{ margin: 0 }}>โหมดเดโมในเครื่อง: บัญชีที่ยังไม่มีรหัสของตัวเองใช้รหัสเดโมร่วมได้</p>
        : <p className="sub" style={{ margin: 0 }}>ลืมรหัสผ่าน: ติดต่อผู้ดูแลระบบให้ตั้งรหัสใหม่</p>}
    </form>
  );
}

export function ChangePasswordForm({ forced }: { forced: boolean }) {
  const [st, act] = useFormState(changePasswordAction, null);
  return (
    <form action={act} style={{ display: 'grid', gap: 12 }}>
      {forced && <div className="notice">รหัสผ่านนี้ผู้ดูแลตั้งให้ กรุณาตั้งรหัสผ่านใหม่ของคุณเองก่อนใช้งาน</div>}
      <label className="f">รหัสผ่านปัจจุบัน<input name="current" type="password" autoComplete="current-password" required autoFocus /></label>
      <label className="f">รหัสผ่านใหม่ (อย่างน้อย 8 ตัวอักษร)<input name="next" type="password" autoComplete="new-password" minLength={8} required /></label>
      <label className="f">ยืนยันรหัสผ่านใหม่<input name="confirm" type="password" autoComplete="new-password" minLength={8} required /></label>
      <Err e={st?.error} />
      <Submit label="เปลี่ยนรหัสผ่าน" busy="กำลังบันทึก..." />
    </form>
  );
}

export function SetupForm({ token, username }: { token: string; username: string }) {
  const [st, act] = useFormState(setupAction, null);
  return (
    <form action={act} style={{ display: 'grid', gap: 12 }}>
      <input type="hidden" name="t" value={token} />
      <p className="sub" style={{ margin: 0 }}>ตั้งอีเมลและรหัสผ่านสำหรับบัญชี <b>{username}</b> · ลิงก์นี้ใช้ได้ครั้งเดียว</p>
      <label className="f">อีเมล (ใช้ล็อกอิน)<input name="email" type="email" autoComplete="username" autoCapitalize="none" required autoFocus /></label>
      <label className="f">รหัสผ่าน (อย่างน้อย 8 ตัวอักษร)<input name="password" type="password" autoComplete="new-password" minLength={8} required /></label>
      <label className="f">ยืนยันรหัสผ่าน<input name="confirm" type="password" autoComplete="new-password" minLength={8} required /></label>
      <Err e={st?.error} />
      <Submit label="ตั้งบัญชีและเข้าสู่ระบบ" busy="กำลังบันทึก..." />
    </form>
  );
}
