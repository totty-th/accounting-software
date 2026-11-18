// M68 ตรรกะล็อกอิน/รหัสผ่าน (แยกจาก server action เพื่อทดสอบกับ PGlite ได้)
import { checkPassword, hashPassword, passwordProblem, tokenHash } from './password';

export type Q = { q<T = any>(sql: string, params?: unknown[]): Promise<T[]> };
export const BAD = 'อีเมลหรือรหัสผ่านไม่ถูกต้อง';
export const MAX_FAILS = 5, LOCK_MIN = 5;
const LOCKED = `ลองผิดหลายครั้งเกินไป กรุณารอ ${LOCK_MIN} นาทีแล้วลองใหม่`;

export type LoginOk = { id: string; username: string; role: string; v: number; mustChange: boolean };
/** ตรวจอีเมล+รหัสผ่าน · โหมดเดโม (เครื่องตัวเอง) รับชื่อผู้ใช้ และรหัสเดโมร่วมได้เมื่อบัญชียังไม่มีรหัสของตัวเอง */
export async function attemptLogin(db: Q, ident: string, password: string, mode: 'password' | 'demo', demoPw = 'demo1234', sameSecret = (a: string, b: string) => a === b)
  : Promise<{ user: LoginOk } | { error: string }> {
  const id = ident.trim().toLowerCase();
  if (!id || !password) return { error: BAD };
  const u = (await db.q(`select id, username, role, is_active, password_hash, must_change_password, session_version, failed_logins,
      locked_until > now() as locked from app_users where lower(email) = $1 ${mode === 'demo' ? 'or username = $1' : ''} limit 1`, [id]))[0];
  if (u?.locked) return { error: LOCKED };
  let ok = !!u && u.is_active && (await checkPassword(password, u.password_hash));
  if (!ok && u?.is_active && mode === 'demo' && !u.password_hash) ok = sameSecret(password, demoPw);
  if (!u) { await checkPassword(password, null); return { error: BAD }; }
  if (!ok) {
    const r = (await db.q(`update app_users set failed_logins = failed_logins + 1,
        locked_until = case when failed_logins + 1 >= $2 then now() + make_interval(mins => $3) else locked_until end
      where id = $1 returning locked_until > now() as locked`, [u.id, MAX_FAILS, LOCK_MIN]))[0];
    return { error: r?.locked ? LOCKED : BAD };
  }
  if (u.failed_logins || u.locked_until) await db.q(`update app_users set failed_logins = 0, locked_until = null where id = $1`, [u.id]);
  return { user: { id: u.id, username: u.username, role: u.role, v: u.session_version, mustChange: !!u.must_change_password } };
}

/** ผู้ดูแลตั้ง/รีเซ็ตรหัส → ผู้ใช้ต้องเปลี่ยนเองตอนเข้าครั้งถัดไป · คุกกี้เดิมของผู้ใช้นั้นใช้ไม่ได้ */
export async function adminSetPassword(db: Q, userId: string, pw: string): Promise<string | null> {
  const p = passwordProblem(pw); if (p) return p;
  const r = await db.q(`update app_users set password_hash = $2, must_change_password = true, session_version = session_version + 1,
    failed_logins = 0, locked_until = null, password_set_at = now() where id = $1 returning id`, [userId, await hashPassword(pw)]);
  return r.length ? null : 'ไม่พบผู้ใช้';
}

/** ผู้ใช้เปลี่ยนรหัสเอง: ต้องใส่รหัสเดิมถูก · คืนเวอร์ชันใหม่ (ใช้ออกคุกกี้ใหม่) */
export async function changeOwnPassword(db: Q, userId: string, current: string, next: string, confirm: string): Promise<{ error: string } | { v: number }> {
  if (next !== confirm) return { error: 'รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน' };
  const p = passwordProblem(next); if (p) return { error: p };
  const u = (await db.q(`select password_hash from app_users where id = $1 and is_active`, [userId]))[0];
  if (!u || !(await checkPassword(current, u.password_hash))) return { error: 'รหัสผ่านปัจจุบันไม่ถูกต้อง' };
  if (current === next) return { error: 'รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสเดิม' };
  const r = (await db.q(`update app_users set password_hash = $2, must_change_password = false, session_version = session_version + 1,
    password_set_at = now() where id = $1 returning session_version`, [userId, await hashPassword(next)]))[0];
  return { v: r.session_version };
}

/** ลิงก์ตั้งบัญชีครั้งแรก (ใช้ครั้งเดียว): ตั้งอีเมล+รหัสผ่านเอง · คืนผู้ใช้เพื่อออกคุกกี้ */
export async function setupWithToken(db: Q, token: string, email: string, pw: string, confirm: string): Promise<{ error: string } | { user: LoginOk }> {
  const u = (await db.q(`select id from app_users where setup_token_hash = $1 and setup_token_expires > now() and is_active`, [tokenHash(token || '-')]))[0];
  if (!u) return { error: 'ลิงก์ไม่ถูกต้อง หมดอายุ หรือใช้ไปแล้ว' };
  const em = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) return { error: 'อีเมลไม่ถูกต้อง' };
  if (pw !== confirm) return { error: 'รหัสผ่านทั้งสองช่องไม่ตรงกัน' };
  const p = passwordProblem(pw); if (p) return { error: p };
  try {
    const r = (await db.q(`update app_users set email = $2, password_hash = $3, must_change_password = false, session_version = session_version + 1,
      setup_token_hash = null, setup_token_expires = null, failed_logins = 0, locked_until = null, password_set_at = now()
      where id = $1 returning id, username, role, session_version`, [u.id, em, await hashPassword(pw)]))[0];
    return { user: { id: r.id, username: r.username, role: r.role, v: r.session_version, mustChange: false } };
  } catch (e: any) {
    if (String(e?.message ?? e).includes('app_users_email_uq') || e?.code === '23505') return { error: 'อีเมลนี้มีผู้ใช้อื่นใช้แล้ว' };
    throw e;
  }
}
