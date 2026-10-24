import { apiUser, canViewSalesDoc } from '@/lib/auth';
import { loadView } from '@/lib/doc-view';
import { buildDocPdf } from '@/lib/doc-pdf';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /sales/{id}/pdf → ต้นฉบับ; ?both=1 → ต้นฉบับ+สำเนา; ?copy=1 → สำเนาอย่างเดียว
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const au = await apiUser(['sales.read', 'quote.own']); if (au instanceof Response) return au;
  const v = await loadView(params.id);
  if (!v || !(await canViewSalesDoc(au, v.doc.id))) return Response.json({ error: 'ไม่พบเอกสาร' }, { status: 404 });
  const q = new URL(req.url).searchParams;
  const pdf = await buildDocPdf(v, q.get('both') === '1' ? 'both' : q.get('copy') === '1' ? 'copy' : 'original');
  return new Response(pdf, { headers: { 'content-type': 'application/pdf',
    'content-disposition': `inline; filename="${v.doc.doc_no}.pdf"`, 'cache-control': 'no-store' } });
}
