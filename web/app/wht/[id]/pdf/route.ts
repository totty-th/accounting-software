import { getDb } from '@/lib/db';
import { buildCertPdf, type CertData } from '@/lib/wht-pdf';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /wht/{id}/pdf            → PDF 50 ทวิ (ถ้ายังขาดข้อมูลสำคัญ ตอบ 422 พร้อมรายการที่ขาด)
// GET /wht/{id}/pdf?draft=1    → ออกได้แม้ข้อมูลไม่ครบ (ช่องที่ขาดเว้นว่าง) สำหรับร่าง
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const db = await getDb();
  let data: CertData;
  try {
    data = (await db.q<{ d: CertData }>('select wht_cert_data($1) as d', [params.id]))[0].d;
  } catch (e: any) {
    return Response.json({ error: String(e?.message ?? e).replace(/^error:\s*/i, '') }, { status: 404 });
  }
  const draft = new URL(req.url).searchParams.get('draft') === '1';
  if (data.missing.length && !draft)
    return Response.json({ error: 'ข้อมูลยังไม่ครบสำหรับออก 50 ทวิ', missing: data.missing }, { status: 422 });
  const pdf = await buildCertPdf(data);
  return new Response(pdf, { headers: {
    'content-type': 'application/pdf',
    'content-disposition': `inline; filename="${data.cert_no}.pdf"`,
    'cache-control': 'no-store' } });
}
