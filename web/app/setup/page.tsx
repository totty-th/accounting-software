import { getDb } from '@/lib/db';
import { tokenHash } from '@/lib/password';
import { SetupForm } from '@/components/LoginForm';

export const dynamic = 'force-dynamic';
// M68 ลิงก์ตั้งบัญชีครั้งแรก /setup?t=... (สาธารณะ — โทเคนเก็บเป็น sha256, หมดอายุตามที่ตั้ง, ใช้ครั้งเดียว)
export default async function Setup({ searchParams }: { searchParams: { t?: string } }) {
  const t = searchParams.t ?? '';
  const u = t ? (await (await getDb()).q('select username from app_users where setup_token_hash=$1 and setup_token_expires > now() and is_active', [tokenHash(t)]))[0] : null;
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 16 }}>
      <div className="panel" style={{ width: 'min(400px, 100%)', maxWidth: 'none' }}>
        <div className="brand" style={{ marginBottom: 14 }}><span className="logo">฿</span>ระบบบัญชี</div>
        <h2 style={{ margin: '0 0 12px' }}>ตั้งบัญชีครั้งแรก</h2>
        {u ? <SetupForm token={t} username={u.username} /> : <p className="sub">ลิงก์ไม่ถูกต้อง หมดอายุ หรือใช้ไปแล้ว · <a href="/login">ไปหน้าเข้าสู่ระบบ</a></p>}
      </div>
    </div>
  );
}
