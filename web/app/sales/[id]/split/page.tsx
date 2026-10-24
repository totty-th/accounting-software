import { notFound } from 'next/navigation';
import { requirePage, canViewSalesDoc } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { SplitForm } from '@/components/SplitForm';

export default async function Split({ params }: { params: { id: string } }) {
  const user = await requirePage(['sales.write']);
  const db = await getDb();
  const o = (await db.q<any>(`select id, doc_no, status, total from sales_docs where (id::text=$1 or doc_no=$1) and doc_type='QT'`, [decodeURIComponent(params.id)]))[0];
  if (!o || !(await canViewSalesDoc(user, o.id))) notFound();
  if (!['pending_approval', 'approved', 'partial'].includes(o.status))
    return <div className="panel empty">แบ่งจ่ายได้เฉพาะใบเสนอราคาที่รออนุมัติ อนุมัติแล้ว หรือแบ่งจ่ายอยู่</div>;
  const s = (await db.q<any>('select quotation_billing_summary($1) as s', [o.id]))[0].s;
  return (<>
    <div className="top"><div><h1>แบ่งจ่าย {o.doc_no}</h1><p className="sub">เรียกเก็บเป็นงวด ออกใบแจ้งหนี้หรือขายสดตามเปอร์เซ็นต์ จำนวนเงิน หรือจำนวนสินค้า</p></div></div>
    <SplitForm id={o.id} docNo={o.doc_no} summary={s} />
  </>);
}
