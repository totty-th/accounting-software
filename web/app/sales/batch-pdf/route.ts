import { PDFDocument } from 'pdf-lib';
import { apiUser, canViewSalesDoc } from '@/lib/auth';
import { loadView } from '@/lib/doc-view';
import { buildDocPdf } from '@/lib/doc-pdf';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /sales/batch-pdf?ids=a,b,c[&download=1] → รวมเอกสารที่เลือกเป็น PDF ไฟล์เดียว (ต้นฉบับ) เพื่อพิมพ์หรือดาวน์โหลดทีเดียว
export async function GET(req: Request) {
  const au = await apiUser(['sales.read', 'quote.own']); if (au instanceof Response) return au;
  const q = new URL(req.url).searchParams;
  const ids = (q.get('ids') ?? '').split(',').filter(Boolean).slice(0, 50);
  if (!ids.length) return Response.json({ error: 'ยังไม่ได้เลือกเอกสาร' }, { status: 400 });
  const out = await PDFDocument.create(); let n = 0;
  for (const id of ids) {
    const v = await loadView(id); if (!v || !(await canViewSalesDoc(au, v.doc.id))) continue;
    const src = await PDFDocument.load(await buildDocPdf(v, 'original'));
    (await out.copyPages(src, src.getPageIndices())).forEach(p => out.addPage(p)); n++;
  }
  if (!n) return Response.json({ error: 'ไม่พบเอกสาร' }, { status: 404 });
  return new Response(await out.save(), { headers: { 'content-type': 'application/pdf',
    'content-disposition': `${q.get('download') === '1' ? 'attachment' : 'inline'}; filename="documents.pdf"`, 'cache-control': 'no-store' } });
}
