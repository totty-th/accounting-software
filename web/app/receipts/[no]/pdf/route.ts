import { apiUser } from '@/lib/auth';
import { loadReceiptView, receiptIdByNo } from '@/lib/receipt-view';
import { buildReceiptPdf } from '@/lib/receipt-pdf';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /receipts/{เลขที่}/pdf → ต้นฉบับ; ?both=1 → ต้นฉบับ+สำเนา; ?copy=1 → สำเนาอย่างเดียว
export async function GET(req: Request, { params }: { params: { no: string } }) {
  const au = await apiUser(['receipts.read']); if (au instanceof Response) return au;
  const v = await loadReceiptView(await receiptIdByNo(decodeURIComponent(params.no)));
  if (!v) return Response.json({ error: 'ไม่พบใบเสร็จ' }, { status: 404 });
  const q = new URL(req.url).searchParams;
  const pdf = await buildReceiptPdf(v, q.get('both') === '1' ? 'both' : q.get('copy') === '1' ? 'copy' : 'original');
  return new Response(pdf, { headers: { 'content-type': 'application/pdf',
    'content-disposition': `inline; filename="${v.receipt.receipt_no}.pdf"`, 'cache-control': 'no-store' } });
}
