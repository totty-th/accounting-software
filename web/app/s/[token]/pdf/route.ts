import { loadViewByToken } from '@/lib/doc-view';
import { buildDocPdf } from '@/lib/doc-pdf';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_: Request, { params }: { params: { token: string } }) {
  const v = await loadViewByToken(params.token);
  if (!v) return Response.json({ error: 'ไม่พบเอกสาร' }, { status: 404 });
  const pdf = await buildDocPdf(v, 'original');
  return new Response(pdf, { headers: { 'content-type': 'application/pdf',
    'content-disposition': `inline; filename="${v.doc.doc_no}.pdf"`, 'cache-control': 'no-store' } });
}
