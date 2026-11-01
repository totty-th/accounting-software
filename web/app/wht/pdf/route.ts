import { PDFDocument } from 'pdf-lib';
import { apiUser } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { buildCertPdf, type CertData } from '@/lib/wht-pdf';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /wht/pdf?ids=a&ids=b → PDF 50 ทวิ รวมหลายใบเป็นไฟล์เดียว (ข้ามใบที่ไม่ใช่ "ดำเนินการแล้ว")
export async function GET(req: Request) {
  const au = await apiUser('wht.read'); if (au instanceof Response) return au;
  const ids = new URL(req.url).searchParams.getAll('ids').slice(0, 100);
  if (!ids.length) return Response.json({ error: 'ยังไม่ได้เลือกเอกสาร' }, { status: 400 });
  const db = await getDb(), out = await PDFDocument.create(); let n = 0; const skipped: string[] = [];
  for (const id of ids) {
    try {
      const d = (await db.q<{ d: CertData }>('select wht_cert_data($1) as d', [id]))[0].d;
      const src = await PDFDocument.load(await buildCertPdf(d));
      (await out.copyPages(src, src.getPageIndices())).forEach(p => out.addPage(p)); n++;
    } catch { skipped.push(id); }
  }
  if (!n) return Response.json({ error: 'ไม่มีเอกสารที่ออก PDF ได้ (ต้องเป็นสถานะดำเนินการแล้ว)', skipped }, { status: 422 });
  return new Response(await out.save(), { headers: { 'content-type': 'application/pdf', 'content-disposition': 'inline; filename="wht-combined.pdf"', 'cache-control': 'no-store' } });
}
