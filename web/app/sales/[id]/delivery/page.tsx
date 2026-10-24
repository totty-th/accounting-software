import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadView } from '@/lib/doc-view';
import { requirePage, canViewSalesDoc } from '@/lib/auth';
import { DeliverySheet } from '@/components/DeliverySheet';
import { PrintButton } from '@/components/ShareTools';

export const dynamic = 'force-dynamic';

// หน้าพิมพ์ใบส่งของ (เฉพาะ QT ที่อนุมัติแล้ว/แปลงแล้ว และ INV)
export default async function DeliveryPrint({ params, searchParams }: { params: { id: string }; searchParams: { c?: string } }) {
  const user = await requirePage(['sales.read', 'quote.own']);
  const v = await loadView(params.id);
  if (!v || !(await canViewSalesDoc(user, v.doc.id)) || !['QT', 'INV'].includes(v.doc.doc_type)) notFound();
  const ok = v.doc.doc_type === 'INV' || ['approved', 'converted'].includes(v.doc.status);
  return (
    <>
      <div className="top noprint">
        <div><h1>ใบส่งของ {v.doc.doc_no}</h1><p className="sub"><Link href={`/sales/${v.doc.doc_no}`}>← กลับไปที่เอกสาร</Link></p></div>
        <div className="acts"><PrintButton />
          <a className="btn ghost" href={`/sales/${v.doc.doc_no}/pdf?kind=delivery`}>ดาวน์โหลด PDF</a>
          <a className="btn ghost" href={`/sales/${v.doc.doc_no}/pdf?kind=delivery&both=1`}>PDF ต้นฉบับ+สำเนา</a></div>
      </div>
      {!ok && <p className="sub noprint">ใบเสนอราคายังไม่อนุมัติ — ยังไม่ควรออกใบส่งของ</p>}
      {!v.doc.delivery_mode && <p className="sub noprint">ยังไม่ได้กรอกข้อมูลจัดส่ง (กรอกได้ที่หน้าเอกสาร) ใบส่งของจะไม่มีบล็อกที่อยู่ส่ง</p>}
      <DeliverySheet v={v} copy={searchParams.c === '1'} />
    </>
  );
}
