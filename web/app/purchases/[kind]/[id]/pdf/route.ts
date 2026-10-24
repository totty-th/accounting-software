import { currentUser } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { buildPurchasePdf, loadPurchaseView, type PKind } from '@/lib/purchase-pdf';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_: Request, { params }: { params: { kind: string; id: string } }) {
  const u = await currentUser();
  if (!u || !can(u.role, 'expenses.read')) return Response.json({ error: 'ไม่มีสิทธิ์' }, { status: 403 });
  const k = params.kind.toUpperCase() as PKind;
  if (!['PO', 'RI', 'PAY', 'EXP'].includes(k)) return Response.json({ error: 'ไม่พบเอกสาร' }, { status: 404 });
  const v = await loadPurchaseView(k, params.id);
  if (!v) return Response.json({ error: 'ไม่พบเอกสาร' }, { status: 404 });
  return new Response(await buildPurchasePdf(v), { headers: { 'content-type': 'application/pdf',
    'content-disposition': `inline; filename="${v.no}.pdf"`, 'cache-control': 'no-store' } });
}
