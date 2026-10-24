// คุกกี้เซสชันแบบเซ็นลายเซ็น (HMAC-SHA256) ใช้ได้ทั้งใน middleware (edge) และฝั่งเซิร์ฟเวอร์ — ใช้ Web Crypto อย่างเดียว
export const COOKIE = 'sid';
export const SESSION_HOURS = 12;

export const authMode = (): 'supabase' | 'demo' => (process.env.SUPABASE_URL ? 'supabase' : 'demo');

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (s) return s;
  if (authMode() === 'supabase') throw new Error('ต้องตั้ง SESSION_SECRET เมื่อใช้ Supabase Auth');
  return 'demo-only-session-secret';   // โหมดเดโมเท่านั้น
}

const enc = new TextEncoder();
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const key = () => crypto.subtle.importKey('raw', enc.encode(secret()), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);

export async function signSession(username: string, now = Date.now()): Promise<string> {
  const body = b64(enc.encode(JSON.stringify({ u: username, e: Math.floor(now / 1000) + SESSION_HOURS * 3600 })));
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await key(), enc.encode(body)));
  return `${body}.${b64(sig)}`;
}

/** คืนชื่อผู้ใช้ถ้าลายเซ็นถูกและยังไม่หมดอายุ */
export async function verifySession(token: string | undefined, now = Date.now()): Promise<string | null> {
  if (!token) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  try {
    const ok = await crypto.subtle.verify('HMAC', await key(), unb64(sig), enc.encode(body));
    if (!ok) return null;
    const p = JSON.parse(new TextDecoder().decode(unb64(body)));
    return typeof p.u === 'string' && typeof p.e === 'number' && p.e * 1000 > now ? p.u : null;
  } catch { return null; }
}
