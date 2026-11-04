import { apiUser } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { buildPrintshopPdf } from '@/lib/doc-printshop';
import { DOC_TITLE } from '@/lib/doc-view';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /settings/design/template/{QT|INV|CA|CN|DN} → แม่แบบเปล่าสำหรับส่งโรงพิมพ์ (กระดาษต่อเนื่อง 8.5x11 นิ้ว, มีข้อมูลบริษัท)
export async function GET(_req: Request, { params }: { params: { type: string } }) {
  const au = await apiUser(['settings.company']); if (au instanceof Response) return au;
  const t = params.type;
  if (!['QT', 'INV', 'CA', 'CN', 'DN'].includes(t) || !DOC_TITLE[t]) return Response.json({ error: 'ชนิดเอกสารไม่รองรับแบบโรงพิมพ์' }, { status: 400 });
  const co = (await (await getDb()).q<any>('select name, address, tax_id from company_profile limit 1'))[0] ?? null;
  const pdf = await buildPrintshopPdf({ docType: t, company: co, blank: true });
  return new Response(pdf, { headers: { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="printshop-template-${t}.pdf"`, 'cache-control': 'no-store' } });
}
