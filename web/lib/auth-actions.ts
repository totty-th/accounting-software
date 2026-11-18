'use server';
import { createHash, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getDb } from './db';
import { COOKIE, SESSION_HOURS, authMode, signSession } from './session';
import { homeOf, isRole } from './permissions';
import { attemptLogin, changeOwnPassword, setupWithToken } from './login';
import { currentUser } from './auth';

const sha = (s: string) => createHash('sha256').update(s).digest();
const sameSecret = (a: string, b: string) => timingSafeEqual(sha(a), sha(b));

async function issue(username: string, v: number) {
  cookies().set(COOKIE, await signSession(username, v), {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' && !process.env.INSECURE_COOKIES, path: '/', maxAge: SESSION_HOURS * 3600 });
}

export async function loginAction(_prev: { error?: string } | null, f: FormData): Promise<{ error?: string }> {
  const r = await attemptLogin(await getDb(), String(f.get('email') ?? ''), String(f.get('password') ?? ''), authMode(),
    process.env.DEMO_PASSWORD ?? 'demo1234', sameSecret);
  if ('error' in r) return r;
  if (!isRole(r.user.role)) return { error: 'บัญชีนี้ไม่มีตำแหน่งที่ใช้ได้' };
  await issue(r.user.username, r.user.v);
  redirect(r.user.mustChange ? '/change-password' : homeOf(r.user.role));
}

export async function changePasswordAction(_prev: { error?: string } | null, f: FormData): Promise<{ error?: string }> {
  const me = await currentUser({ allowMustChange: true });
  if (!me) redirect('/login');
  const r = await changeOwnPassword(await getDb(), me.id, String(f.get('current') ?? ''), String(f.get('next') ?? ''), String(f.get('confirm') ?? ''));
  if ('error' in r) return r;
  await issue(me.username, r.v);
  redirect(homeOf(me.role) + (homeOf(me.role).includes('?') ? '&' : '?') + 'pw=changed');
}

export async function setupAction(_prev: { error?: string } | null, f: FormData): Promise<{ error?: string }> {
  const r = await setupWithToken(await getDb(), String(f.get('t') ?? ''), String(f.get('email') ?? ''), String(f.get('password') ?? ''), String(f.get('confirm') ?? ''));
  if ('error' in r) return r;
  await issue(r.user.username, r.user.v);
  redirect(isRole(r.user.role) ? homeOf(r.user.role) : '/');
}

export async function logoutAction() {
  cookies().delete(COOKIE);
  redirect('/login');
}
