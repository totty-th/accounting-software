import { scrypt as scryptCb, randomBytes, timingSafeEqual, createHash } from 'node:crypto';

// M68: รหัสผ่านเก็บแบบ scrypt (N=16384, r=8, p=1, key 64 ไบต์, salt 16 ไบต์) → "scrypt$N$r$p$salt$key"
const scrypt = (pw: string, salt: Buffer, len: number, o: { N: number; r: number; p: number }) =>
  new Promise<Buffer>((res, rej) => scryptCb(pw, salt, len, { ...o, maxmem: 64 * 1024 * 1024 }, (e, k) => (e ? rej(e) : res(k))));

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16), N = 16384, r = 8, p = 1;
  const k = await scrypt(pw, salt, 64, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${k.toString('base64')}`;
}
export async function checkPassword(pw: string, stored: string | null | undefined): Promise<boolean> {
  const parts = (stored ?? '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') { await hashPassword(pw); return false; }   // ใช้เวลาเท่ากันแม้ไม่มีรหัส
  const [, N, r, p, salt, key] = parts;
  const want = Buffer.from(key, 'base64');
  const got = await scrypt(pw, Buffer.from(salt, 'base64'), want.length, { N: +N, r: +r, p: +p });
  return got.length === want.length && timingSafeEqual(got, want);
}
/** ข้อความผิดพลาดถ้ารหัสผ่านไม่ผ่านเกณฑ์ · ผ่าน = null */
export const passwordProblem = (pw: string): string | null =>
  pw.length < 8 ? 'รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร' : pw.length > 128 ? 'รหัสผ่านยาวเกินไป' : null;
export const tokenHash = (t: string) => createHash('sha256').update(t).digest('hex');
export const newToken = () => randomBytes(24).toString('base64url');
