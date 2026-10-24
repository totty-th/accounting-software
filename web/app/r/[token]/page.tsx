import { notFound } from 'next/navigation';
import { loadReceiptView, receiptIdByToken } from '@/lib/receipt-view';
import { ReceiptSheet } from '@/components/ReceiptSheet';
import { PrintButton } from '@/components/ShareTools';

export const dynamic = 'force-dynamic';

// หน้าสาธารณะสำหรับลูกค้า (ไม่ต้องล็อกอิน) เข้าถึงด้วยรหัสลิงก์เท่านั้น
export async function generateMetadata({ params }: { params: { token: string } }) {
  const v = await loadReceiptView(await receiptIdByToken(params.token));
  return { title: v ? `ใบเสร็จรับเงิน ${v.receipt.receipt_no}` : 'ไม่พบเอกสาร', robots: { index: false, follow: false } };
}

export default async function SharedReceipt({ params, searchParams }: { params: { token: string }; searchParams: { c?: string } }) {
  const v = await loadReceiptView(await receiptIdByToken(params.token));
  if (!v) notFound();
  return (
    <div className="public">
      <div className="pub-bar noprint">
        <span>{v.company?.name}</span>
        <span className="acts"><PrintButton /><a className="btn" href={`/r/${params.token}/pdf`}>ดาวน์โหลด PDF</a></span>
      </div>
      <ReceiptSheet v={v} copy={searchParams.c === '1'} />
    </div>
  );
}
