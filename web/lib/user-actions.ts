'use server';
import { revalidatePath } from 'next/cache';
import { getDb } from './db';
import { currentUser } from './auth';
import { can, isRole } from './permissions';
import { adminSetPassword } from './login';
import { passwordProblem } from './password';

export type Result = { error?: string; ok?: true };
const clean = (e: any) => {
  const m = String(e?.message ?? e).replace(/^error:\s*/i, '');
  return m.includes('app_users_email_uq') ? 'อีเมลนี้มีผู้ใช้อื่นใช้แล้ว' : m;
};
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

async function admin() {
  const u = await currentUser();
  return u && can(u.role, 'users.manage') ? u : null;
}

// M68: ผู้ดูแลกำหนดอีเมล (ใช้ล็อกอิน) + รหัสผ่านเริ่มต้น → ผู้ใช้ต้องเปลี่ยนรหัสเองตอนเข้าครั้งแรก
export async function createUser(p: { username: string; display: string; role: string; password: string; first?: string; last?: string; phone?: string; email: string }): Promise<Result> {
  if (!(await admin())) return { error: 'ไม่มีสิทธิ์ทำรายการนี้' };
  if (!isRole(p.role)) return { error: 'ตำแหน่งไม่ถูกต้อง' };
  const email = (p.email ?? '').trim().toLowerCase();
  if (!EMAIL.test(email)) return { error: 'กรุณากรอกอีเมลให้ถูกต้อง (ใช้ล็อกอิน)' };
  const pp = passwordProblem(p.password ?? ''); if (pp) return { error: pp };
  const username = p.username.trim().toLowerCase();
  try {
    const db = await getDb();
    if ((await db.q('select 1 from app_users where lower(email)=$1', [email])).length) return { error: 'อีเมลนี้มีผู้ใช้อื่นใช้แล้ว' };
    const id = (await db.q<any>('select app_user_create($1,$2,$3,null) as id', [username, p.display, p.role]))[0].id;
    await db.q('select app_user_set_profile($1,$2,$3,$4,$5,true)', [id, p.first ?? '', p.last ?? '', p.phone ?? '', email]);
    const e = await adminSetPassword(db, id, p.password);
    if (e) return { error: e };
  } catch (e) { return { error: clean(e) }; }
  revalidatePath('/settings/users');
  return { ok: true };
}

export async function updateUser(p: { id: string; display?: string; role?: string; active?: boolean; email?: string }): Promise<Result> {
  const me = await admin();
  if (!me) return { error: 'ไม่มีสิทธิ์ทำรายการนี้' };
  if (p.id === me.id && (p.role !== undefined || p.active === false)) return { error: 'เปลี่ยนตำแหน่งหรือปิดใช้งานบัญชีของตัวเองไม่ได้ (กันล็อกตัวเองออก)' };
  if (p.role !== undefined && !isRole(p.role)) return { error: 'ตำแหน่งไม่ถูกต้อง' };
  const email = p.email === undefined ? null : p.email.trim().toLowerCase();
  if (email !== null && !EMAIL.test(email)) return { error: 'อีเมลไม่ถูกต้อง' };
  try {
    await (await getDb()).q(`update app_users set display_name = coalesce($2, display_name), role = coalesce($3, role),
      is_active = coalesce($4, is_active), email = coalesce($5, email),
      session_version = session_version + case when $4 = false or $5 is not null then 1 else 0 end where id = $1`,
      [p.id, p.display?.trim() || null, p.role ?? null, p.active ?? null, email]);
  } catch (e) { return { error: clean(e) }; }
  revalidatePath('/settings/users');
  return { ok: true };
}

export async function resetPassword(p: { id: string; password: string }): Promise<Result> {
  const me = await admin();
  if (!me) return { error: 'ไม่มีสิทธิ์ทำรายการนี้' };
  if (p.id === me.id) return { error: 'เปลี่ยนรหัสของตัวเองที่เมนู "เปลี่ยนรหัสผ่าน"' };
  try {
    const db = await getDb();
    if (!(await db.q('select 1 from app_users where id=$1 and email is not null', [p.id])).length) return { error: 'ต้องกำหนดอีเมลให้ผู้ใช้นี้ก่อน (ใช้ล็อกอิน)' };
    const e = await adminSetPassword(db, p.id, p.password);
    if (e) return { error: e };
  } catch (e) { return { error: clean(e) }; }
  revalidatePath('/settings/users');
  return { ok: true };
}

// ข้อมูลส่วนตัวของตัวเอง (ทุกตำแหน่งแก้ได้) — ตำแหน่ง/ชื่อผู้ใช้/อีเมลเปลี่ยนเองไม่ได้ ต้องให้ผู้ดูแลแก้
export async function saveMyProfile(p: { first: string; last: string; phone: string }): Promise<Result> {
  const me = await currentUser();
  if (!me) return { error: 'กรุณาเข้าสู่ระบบ' };
  if (!p.first.trim()) return { error: 'กรุณากรอกชื่อ' };
  try { await (await getDb()).q('select app_user_set_profile($1,$2,$3,$4)', [me.id, p.first, p.last, p.phone]); }
  catch (e) { return { error: clean(e) }; }
  revalidatePath('/settings/profile');
  return { ok: true };
}
