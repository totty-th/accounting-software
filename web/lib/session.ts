// คุกกี้เซสชันแบบเซ็นลายเซ็น (HMAC-SHA256) ใช้ได้ทั้งใน middleware (edge) และฝั่งเซิร์ฟเวอร์ — ใช้ Web Crypto อย่างเดียว
export const COOKIE = 'sid';
export const SESSION_HOURS = 12;

// M68: ต่อฐานข้อมูลจริง (มี DATABASE_URL) = 'password' รหัสผ่านรายคน · ไม่มี (PGlite ในเครื่อง) = 'demo' ใช้รหัสเดโมร่วมได้
export const authMode = (): 'password' | 'demo' => (process.env.DATABASE_URL ? 'password' : 'demo');

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 32) return s;
  if (authMode() === 'password') throw new Error('ต้องตั้ง SESSION_SECRET (อย่างน้อย 32 ตัวอักษร) เมื่อใช้ฐานข้อมูลจริง');
  return 'demo-only-session-secret';   // โหมดเดโมในเครื่องเท่านั้น
}

const enc = new TextEncoder();
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const key = () => crypto.subtle.importKey('raw', enc.encode(secret()), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);

export type Sess = { u: string; v: number };
/** u = ชื่อผู้ใช้ · v = session_version (เปลี่ยนรหัส/รีเซ็ต → เลขขยับ คุกกี้เก่าใช้ไม่ได้) */
export async function signSession(username: string, version = 0, now = Date.now()): Promise<string> {
  const body = b64(enc.encode(JSON.stringify({ u: username, v: version, e: Math.floor(now / 1000) + SESSION_HOURS * 3600 })));
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await key(), enc.encode(body)));
  return `${body}.${b64(sig)}`;
}

/** คืน {ชื่อผู้ใช้, เวอร์ชัน} ถ้าลายเซ็นถูกและยังไม่หมดอายุ */
export async function verifySession(token: string | undefined, now = Date.now()): Promise<Sess | null> {
  if (!token) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  try {
    const ok = await crypto.subtle.verify('HMAC', await key(), unb64(sig), enc.encode(body));
    if (!ok) return null;
    const p = JSON.parse(new TextDecoder().decode(unb64(body)));
    return typeof p.u === 'string' && typeof p.e === 'number' && p.e * 1000 > now ? { u: p.u, v: typeof p.v === 'number' ? p.v : 0 } : null;
  } catch { return null; }
}
