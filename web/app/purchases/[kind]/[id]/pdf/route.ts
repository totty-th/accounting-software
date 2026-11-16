import { currentUser, canViewBuyDoc } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { buildPurchasePdf, loadPurchaseView, type PKind } from '@/lib/purchase-pdf';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request, { params }: { params: { kind: string; id: string } }) {
  const u = await currentUser();
  if (!u) return Response.json({ error: 'ไม่มีสิทธิ์' }, { status: 403 });
  const k = params.kind.toUpperCase() as PKind;
  if (!['PO', 'RI', 'PAY', 'EXP'].includes(k)) return Response.json({ error: 'ไม่พบเอกสาร' }, { status: 404 });
  // ใบเตรียมจ่าย (PAY) ต้องดูค่าใช้จ่ายได้ทั้งหมด · PO/RI/EXP ตำแหน่ง "ของตัวเอง" ดูได้เฉพาะที่ตัวเองสร้าง
  const okView = k === 'PAY' ? can(u.role, 'expenses.read') : /^[0-9a-f-]{36}$/.test(params.id) && (await canViewBuyDoc(u, k, params.id));
  if (!okView) return Response.json({ error: 'ไม่มีสิทธิ์' }, { status: 403 });
  const v = await loadPurchaseView(k, params.id);
  if (!v) return Response.json({ error: 'ไม่พบเอกสาร' }, { status: 404 });
  return new Response(await buildPurchasePdf(v), { headers: { 'content-type': 'application/pdf',
    'content-disposition': `${new URL(req.url).searchParams.get('download') === '1' ? 'attachment' : 'inline'}; filename="${v.no}.pdf"`, 'cache-control': 'no-store' } });
}
