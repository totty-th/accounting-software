import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getDb } from './db';
import { COOKIE, verifySession } from './session';
import { can, isRole, homeOf, buyScope, type BuyKind, type Perm, type Role } from './permissions';

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
  if (!([] as Perm[]).concat(perm).some(p => can(u.role, p))) redirect(can(u.role, 'quote.own') ? '/sales' : '/forbidden');
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
  if (can(u.role, 'sales.own')) return (await (await getDb()).q(`select 1 from sales_docs where id=$1 and created_by=$2`, [docId, u.id])).length > 0;
  if (!can(u.role, 'quote.own')) return false;
  return (await (await getDb()).q(`select 1 from sales_docs where id=$1 and doc_type='QT' and created_by=$2`, [docId, u.id])).length > 0;
}

const BUY_TABLE: Record<BuyKind, string> = { EXP: 'expenses', RI: 'goods_receipts', PO: 'purchase_orders', WT: 'wht_certs' };
/** เจ้าของเอกสารซื้อ (ผู้สร้าง) · 50 ทวิ นับรวมเอกสารต้นทางที่ตัวเองสร้าง */
export async function ownsBuyDoc(u: { id: string }, kind: BuyKind, id: string): Promise<boolean> {
  const db = await getDb();
  const sql = kind === 'WT'
    ? `select 1 from wht_certs w where w.id=$1 and (w.created_by=$2 or exists (select 1 from expenses e where e.id=w.expense_id and e.created_by=$2))`
    : `select 1 from ${BUY_TABLE[kind]} where id=$1 and created_by=$2`;
  return (await db.q(sql, [id, u.id])).length > 0;
}
/** ดู/แก้เอกสารซื้อใบนี้ได้ไหม: ตำแหน่งที่ดูทั้งหมดได้ = ได้ · ตำแหน่ง "ของตัวเอง" ต้องเป็นผู้สร้าง */
export async function canViewBuyDoc(u: AuthUser, kind: BuyKind, id: string): Promise<boolean> {
  const sc = buyScope(u.role, kind);
  return sc === 'all' || (sc === 'own' && (await ownsBuyDoc(u, kind, id)));
}
/** แก้/ยกเลิกเอกสารซื้อได้ไหม: expenses.write (หรือ wht.write สำหรับ 50 ทวิ) หรือเป็นผู้สร้างในตำแหน่ง "ของตัวเอง" */
export async function canEditBuyDoc(u: AuthUser, kind: BuyKind, id: string): Promise<boolean> {
  if (can(u.role, kind === 'WT' ? 'wht.write' : 'expenses.write')) return true;
  return buyScope(u.role, kind) === 'own' && (await ownsBuyDoc(u, kind, id));
}
