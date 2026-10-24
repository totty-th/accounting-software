import { buildPurchasePdf, loadPurchaseView, purchaseIdByToken } from '@/lib/purchase-pdf';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_: Request, { params }: { params: { token: string } }) {
  const d = await purchaseIdByToken(params.token);
  const v = d && (await loadPurchaseView(d.kind, d.id));
  if (!v) return Response.json({ error: 'ไม่พบเอกสาร' }, { status: 404 });
  return new Response(await buildPurchasePdf(v), { headers: { 'content-type': 'application/pdf',
    'content-disposition': `inline; filename="${v.no}.pdf"`, 'cache-control': 'no-store' } });
}
