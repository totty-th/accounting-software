import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDb, today } from '@/lib/db';
import { requirePage } from '@/lib/auth';
import { CombinedBlForm, type CombinedInit } from '@/components/CombinedBlForm';

export const dynamic = 'force-dynamic';
const d10 = (x: any) => (x ? (x instanceof Date ? x.toISOString() : String(x)).slice(0, 10) : '');

// M65 ใบวางบิลรวม: ?inv=เลขใบแจ้งหนี้ (เริ่มจากเมนูของใบแจ้งหนี้) · ?id=เลขใบวางบิลรวม (แก้ไขขณะรอวางบิล)
export default async function CombinedBl({ searchParams }: { searchParams: { inv?: string; id?: string } }) {
  await requirePage(['sales.write', 'sales.own']);
  const db = await getDb();
  const customers = (await db.q<any>(`select id, coalesce(nullif(business_name,''), contact_name) name, coalesce(credit_days,0) credit_days
    from contacts where not is_cash_default and is_customer order by business_name nulls last`)).map(c => ({ ...c, credit_days: Number(c.credit_days) }));
  let init: CombinedInit | undefined, pre: { contact: string; inv: string } | undefined;
  if (searchParams.id) {
    const b = (await db.q<any>(`select * from sales_docs where doc_no=$1 and doc_type='BL' and is_combined`, [searchParams.id]))[0];
    if (!b) notFound();   // สิทธิ์แก้ตรวจซ้ำตอนบันทึก (ownWriteGate)
    if (b.status !== 'pending_billing') return <div className="panel">ใบวางบิลรวม {b.doc_no} แก้ไขได้เฉพาะตอนรอวางบิล · <Link href={`/sales/${b.doc_no}`}>กลับ</Link></div>;
    const inv = (await db.q<any>(`select i.invoice_id from billing_note_items i join sales_docs d on d.id=i.invoice_id where i.billing_id=$1 and d.doc_type='INV' order by i.line_no`, [b.id])).map(r => r.invoice_id);
    init = { id: b.id, doc_no: b.doc_no, contact: b.contact_id, date: d10(b.doc_date), credit_days: Number(b.credit_days ?? 0), project: b.project ?? '',
      description: b.description ?? '', ref_no: b.ref_no ?? '', note: b.note ?? '', invoices: inv };
  } else if (searchParams.inv) {
    const i = (await db.q<any>(`select id, contact_id from sales_docs where doc_no=$1 and doc_type='INV'`, [searchParams.inv]))[0];
    if (i) pre = { contact: i.contact_id, inv: i.id };
  }
  return (
    <>
      <div className="top"><div><h1>{init ? `แก้ไขใบวางบิลรวม ${init.doc_no}` : 'สร้างใบวางบิลรวม'}</h1>
        <p className="sub"><Link href="/sales?type=BL">← ใบวางบิล</Link> · รวมใบแจ้งหนี้หลายใบของลูกค้าเดียวกันเป็นใบเดียว ไม่ลงบัญชี</p></div></div>
      <CombinedBlForm customers={customers} today={today()} init={init} preselect={pre} />
    </>
  );
}
