import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDb } from '@/lib/db';
import { Pill } from '@/components/Pill';
import { ReceiptSheet, type ReceiptView } from '@/components/ReceiptSheet';
import { PrintButton } from '@/components/ShareTools';

export const dynamic = 'force-dynamic';

// หน้ารายละเอียดใบเสร็จรับเงิน (เปิดด้วยเลขที่ใบเสร็จ) พิมพ์เป็น A4 ได้จากเบราว์เซอร์
export default async function ReceiptDetail({ params }: { params: { no: string } }) {
  const db = await getDb();
  const key = decodeURIComponent(params.no);
  const id = (await db.q<{ id: string }>('select id from receipts where receipt_no=$1', [key]))[0]?.id;
  if (!id) notFound();
  const v = (await db.q<{ v: ReceiptView }>('select receipt_view($1) as v', [id]))[0].v;
  return (
    <>
      <div className="top noprint">
        <div><h1>{v.receipt.receipt_no} <Pill s={v.receipt.status} /></h1><p className="sub"><Link href="/receipts">← ใบเสร็จและการรับเงิน</Link></p></div>
        <div className="acts"><PrintButton /></div>
      </div>
      <div className="detail"><ReceiptSheet v={v} /></div>
    </>
  );
}
