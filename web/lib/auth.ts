import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getDb } from './db';
import { COOKIE, verifySession } from './session';
import { can, isRole, homeOf, type Perm, type Role } from './permissions';

export type AuthUser = { id: string; username: string; displayName: string; role: Role };

/** ผู้ใช้ที่ล็อกอินอยู่ (โหลดจากฐานข้อมูลทุกครั้ง: ปิดใช้งาน/เปลี่ยนตำแหน่งมีผลทันที) */
export async function currentUser(): Promise<AuthUser | null> {
  const username = await verifySession(cookies().get(COOKIE)?.value);   // คุกกี้เก็บชื่อผู้ใช้ (คงที่ทุก instance)
  if (!username) return null;
  const r = (await (await getDb()).q('select id, username, display_name, role from app_users where username=$1 and is_active', [username]))[0];
  if (!r || !isRole(r.role)) return null;
  return { id: r.id, username: r.username, displayName: r.display_name, role: r.role };
}

/** ใช้ต้นหน้า server component: ไม่ล็อกอิน → /login · ไม่มีสิทธิ์ → /forbidden (ผ่านถ้ามีสิทธิ์อย่างน้อยหนึ่งอย่างใน perm) */
export async function requirePage(perm: Perm | Perm[]): Promise<AuthUser> {
  const u = await currentUser();
  if (!u) redirect('/login');
  if (!([] as Perm[]).concat(perm).some(p => can(u.role, p))) redirect(u.role === 'sales' ? '/sales' : '/forbidden');
  return u;
}
export { homeOf };

/** ใช้ใน route handler (PDF/Excel): คืนผู้ใช้ หรือ Response 401/403 */
export async function apiUser(perm: Perm | Perm[]): Promise<AuthUser | Response> {
  const u = await currentUser();
  if (!u) return Response.json({ error: 'กรุณาเข้าสู่ระบบ' }, { status: 401 });
  if (!([] as Perm[]).concat(perm).some(p => can(u.role, p))) return Response.json({ error: 'ไม่มีสิทธิ์เข้าถึง' }, { status: 403 });
  return u;
}

/** ดูเอกสารขายใบนี้ได้ไหม: ผู้ที่มี sales.read ดูได้ทุกใบ · ฝ่ายขายดูได้เฉพาะใบเสนอราคาที่ตัวเองสร้าง */
export async function canViewSalesDoc(u: AuthUser, docId: string): Promise<boolean> {
  if (can(u.role, 'sales.read')) return true;
  if (!can(u.role, 'quote.own')) return false;
  return (await (await getDb()).q(`select 1 from sales_docs where id=$1 and doc_type='QT' and created_by=$2`, [docId, u.id])).length > 0;
}
