'use server';
import { revalidatePath } from 'next/cache';
import { getDb } from './db';
import { currentUser } from './auth';
import { can, isRole } from './permissions';
import { authMode } from './session';

export type Result = { error?: string; ok?: true };
const clean = (e: any) => String(e?.message ?? e).replace(/^error:\s*/i, '');

async function admin() {
  const u = await currentUser();
  return u && can(u.role, 'users.manage') ? u : null;
}

// เรียก Supabase Admin API (ยังไม่ทดสอบ — รอเชื่อม Supabase จริง) ต้องมี SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (เก็บฝั่งเซิร์ฟเวอร์เท่านั้น)
async function supa(method: string, path: string, body: unknown) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('ยังไม่ได้ตั้ง SUPABASE_SERVICE_ROLE_KEY');
  const r = await fetch(`${process.env.SUPABASE_URL}/auth/v1/admin${path}`, {
    method, cache: 'no-store', headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.msg ?? j?.message ?? `Supabase ตอบ ${r.status}`);
  return j;
}
const emailOf = (username: string) => `${username}@${process.env.AUTH_EMAIL_DOMAIN ?? 'accounting.local'}`;
const pwOk = (p: string) => p.length >= 8;

export async function createUser(p: { username: string; display: string; role: string; password?: string; first?: string; last?: string; phone?: string; email?: string }): Promise<Result> {
  if (!(await admin())) return { error: 'ไม่มีสิทธิ์ทำรายการนี้' };
  if (!isRole(p.role)) return { error: 'ตำแหน่งไม่ถูกต้อง' };
  const username = p.username.trim().toLowerCase();
  try {
    let authId: string | null = null;
    if (authMode() === 'supabase') {
      if (!pwOk(p.password ?? '')) return { error: 'รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร' };
      authId = (await supa('POST', '/users', { email: emailOf(username), password: p.password, email_confirm: true })).id;
    }
    const db = await getDb();
    const id = (await db.q<any>('select app_user_create($1,$2,$3,$4) as id', [username, p.display, p.role, authId]))[0].id;
    if (p.first || p.last || p.phone || p.email)
      await db.q('select app_user_set_profile($1,$2,$3,$4,$5,true)', [id, p.first ?? '', p.last ?? '', p.phone ?? '', p.email ?? '']);
  } catch (e) { return { error: clean(e) }; }
  revalidatePath('/settings/users');
  return { ok: true };
}

export async function updateUser(p: { id: string; display?: string; role?: string; active?: boolean }): Promise<Result> {
  const me = await admin();
  if (!me) return { error: 'ไม่มีสิทธิ์ทำรายการนี้' };
  if (p.id === me.id && (p.role !== undefined || p.active === false)) return { error: 'เปลี่ยนตำแหน่งหรือปิดใช้งานบัญชีของตัวเองไม่ได้ (กันล็อกตัวเองออก)' };
  if (p.role !== undefined && !isRole(p.role)) return { error: 'ตำแหน่งไม่ถูกต้อง' };
  try {
    await (await getDb()).q(`update app_users set display_name = coalesce($2, display_name), role = coalesce($3, role),
      is_active = coalesce($4, is_active) where id = $1`, [p.id, p.display?.trim() || null, p.role ?? null, p.active ?? null]);
  } catch (e) { return { error: clean(e) }; }
  revalidatePath('/settings/users');
  return { ok: true };
}

export async function resetPassword(p: { id: string; password: string }): Promise<Result> {
  if (!(await admin())) return { error: 'ไม่มีสิทธิ์ทำรายการนี้' };
  if (authMode() !== 'supabase') return { error: 'โหมดเดโมใช้รหัสผ่านเดโมร่วมกัน ไม่มีรหัสรายบุคคล — ตั้งรหัสได้เมื่อเชื่อม Supabase Auth' };
  if (!pwOk(p.password)) return { error: 'รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร' };
  try {
    const u = (await (await getDb()).q('select auth_user_id from app_users where id=$1', [p.id]))[0];
    if (!u?.auth_user_id) return { error: 'บัญชีนี้ยังไม่ได้ผูกกับ Supabase Auth' };
    await supa('PUT', `/users/${u.auth_user_id}`, { password: p.password });
  } catch (e) { return { error: clean(e) }; }
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
