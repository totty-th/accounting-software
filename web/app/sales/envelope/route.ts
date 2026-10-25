import { apiUser, canViewSalesDoc } from '@/lib/auth';
import { loadView } from '@/lib/doc-view';
import { buildEnvelopePdf } from '@/lib/envelope-pdf';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /sales/envelope?ids=a,b,c → จ่าหน้าซองหลายใบในไฟล์เดียว (หนึ่งหน้าต่อเอกสาร)
export async function GET(req: Request) {
  const au = await apiUser(['sales.read', 'quote.own']); if (au instanceof Response) return au;
  const ids = (new URL(req.url).searchParams.get('ids') ?? '').split(',').filter(Boolean).slice(0, 100);
  if (!ids.length) return Response.json({ error: 'ยังไม่ได้เลือกเอกสาร' }, { status: 400 });
  const views = [];
  for (const id of ids) { const v = await loadView(id); if (v && await canViewSalesDoc(au, v.doc.id)) views.push(v); }
  if (!views.length) return Response.json({ error: 'ไม่พบเอกสาร' }, { status: 404 });
  const pdf = await buildEnvelopePdf(views);
  return new Response(pdf, { headers: { 'content-type': 'application/pdf', 'content-disposition': 'inline; filename="envelopes.pdf"', 'cache-control': 'no-store' } });
}
