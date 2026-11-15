import { loadReceiptView, receiptIdByToken } from '@/lib/receipt-view';
import { buildReceiptPdf } from '@/lib/receipt-pdf';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request, { params }: { params: { token: string } }) {
  const v = await loadReceiptView(await receiptIdByToken(params.token));
  if (!v) return Response.json({ error: 'ไม่พบเอกสาร' }, { status: 404 });
  const pdf = await buildReceiptPdf(v, new URL(req.url).searchParams.get('c') === '1' ? 'copy' : 'original');
  return new Response(pdf, { headers: { 'content-type': 'application/pdf',
    'content-disposition': `inline; filename="${v.receipt.receipt_no}.pdf"`, 'cache-control': 'no-store' } });
}
