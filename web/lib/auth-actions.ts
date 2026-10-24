'use server';
import { createHash, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getDb } from './db';
import { COOKIE, SESSION_HOURS, authMode, signSession } from './session';
import { homeOf, isRole } from './permissions';

const BAD = 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง';

// กันเดารหัส: ผิด 5 ครั้งติดกันล็อกชื่อผู้ใช้นั้น 5 นาที (นับในหน่วยความจำของ instance — เพียงพอสำหรับเดโม; ของจริงควรใช้ที่เก็บกลาง)
const fails = new Map<string, { n: number; until: number }>();
const MAX_FAILS = 5, LOCK_MS = 5 * 60_000;

const sha = (s: string) => createHash('sha256').update(s).digest();
const sameSecret = (a: string, b: string) => timingSafeEqual(sha(a), sha(b));

type Verify = { ok: boolean; authUserId?: string };
async function verifyPassword(username: string, password: string, linked: string | null): Promise<Verify> {
  if (authMode() === 'demo') {
    // โหมดเดโม (ไม่มี Supabase): ทุกคนใช้รหัสเดโมเดียวกัน ตั้งได้ด้วย DEMO_PASSWORD — ห้ามใช้กับข้อมูลจริง
    return { ok: sameSecret(password, process.env.DEMO_PASSWORD ?? 'demo1234') };
  }
  // Supabase Auth (ยังไม่ทดสอบ — รอเชื่อม Supabase จริง): ชื่อผู้ใช้ ↔ อีเมลสังเคราะห์
  const url = process.env.SUPABASE_URL!, apikey = process.env.SUPABASE_PUBLISHABLE_KEY ?? '';
  const email = `${username}@${process.env.AUTH_EMAIL_DOMAIN ?? 'accounting.local'}`;
  const r = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey, 'content-type': 'application/json' }, body: JSON.stringify({ email, password }), cache: 'no-store' });
  if (!r.ok) return { ok: false };
  const j = await r.json();
  const id: string | undefined = j?.user?.id;
  return { ok: !!id && !!linked && id === linked, authUserId: id };
}

export async function loginAction(_prev: { error?: string } | null, f: FormData): Promise<{ error?: string }> {
  const username = String(f.get('username') ?? '').trim().toLowerCase();
  const password = String(f.get('password') ?? '');
  if (!username || !password) return { error: BAD };
  const lock = fails.get(username);
  if (lock && lock.until > Date.now() && lock.n >= MAX_FAILS) return { error: 'ลองผิดหลายครั้งเกินไป กรุณารอ 5 นาทีแล้วลองใหม่' };
  const u = (await (await getDb()).q('select id, username, role, auth_user_id from app_users where username=$1 and is_active', [username]))[0];
  const v = u ? await verifyPassword(username, password, u.auth_user_id) : { ok: false };
  if (!u || !v.ok || !isRole(u.role)) {
    const n = (lock && lock.until > Date.now() ? lock.n : 0) + 1;
    fails.set(username, { n, until: Date.now() + LOCK_MS });
    return { error: BAD };
  }
  fails.delete(username);
  cookies().set(COOKIE, await signSession(u.username)   // เก็บชื่อผู้ใช้ ไม่ใช่ uuid: เดโมบน Vercel มีหลาย instance ที่ uuid ไม่ตรงกัน, {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' && !process.env.INSECURE_COOKIES, path: '/', maxAge: SESSION_HOURS * 3600 });
  redirect(homeOf(u.role));
}

export async function logoutAction() {
  cookies().delete(COOKIE);
  redirect('/login');
}
