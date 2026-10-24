import { notFound } from 'next/navigation';
import { can } from '@/lib/permissions';
import { requirePage, canViewSalesDoc } from '@/lib/auth';
import { getDb, today } from '@/lib/db';
import { qtFormData } from '@/lib/qt-data';
import { QtForm } from '@/components/QtForm';

const d10 = (x: unknown) => (x ? new Date(x as any).toISOString().slice(0, 10) : '');
export default async function EditQt({ params }: { params: { id: string } }) {
  const user = await requirePage(['sales.write', 'quote.own']);
  const db = await getDb();
  const o = (await db.q(`select * from sales_docs where (id::text=$1 or doc_no=$1) and doc_type='QT'`, [decodeURIComponent(params.id)]))[0];
  if (!o || !(await canViewSalesDoc(user, o.id))) notFound();
  if (o.status !== 'pending_approval') return <div className="panel empty">แก้ไขได้เฉพาะใบเสนอราคาที่รออนุมัติ (แก้ใบที่อนุมัติแล้วยังไม่ทดสอบบน FA)</div>;
  const ls = await db.q('select * from sales_doc_lines where doc_id=$1 order by line_no', [o.id]);
  const n = (x: unknown) => String(Number(x));
  const d = await qtFormData();
  const header = { date: d10(o.doc_date), contact: o.contact_id, term_mode: o.term_mode, credit_days: String(o.credit_days), due_date: d10(o.due_date) || d10(o.doc_date),
    salesperson: o.salesperson ?? '', project: o.project ?? '', ref_no: o.ref_no ?? '', description: o.description ?? '', price_mode: o.price_mode,
    warehouse_id: o.warehouse_id ?? '', show_signature: o.show_signature, note: o.note ?? '', internal_note: o.internal_note ?? '' };
  const lines = ls.map(l => ({ product_id: l.product_id ?? '', description: l.description ?? '', unit: l.unit ?? '', qty: n(l.qty), unit_price: n(l.unit_price),
    dtype: l.discount_type, dval: Number(l.discount_value) ? n(l.discount_value) : '', vat: l.vat_exempt ? 'exempt' : n(l.vat_rate ?? 7), wht: n(l.wht_rate) }));
  return (<>
    <div className="top"><div><h1>แก้ไขใบเสนอราคา {o.doc_no}</h1></div></div>
    <QtForm id={o.id} {...d} today={today()} salesperson={o.salesperson ?? user.displayName ?? ''} init={{ header, lines: lines as any }}
      canCreateCustomer={can(user.role, 'contact.create')} />
  </>);
}
