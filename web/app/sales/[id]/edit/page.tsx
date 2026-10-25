import { notFound } from 'next/navigation';
import { can } from '@/lib/permissions';
import { requirePage, canViewSalesDoc } from '@/lib/auth';
import { getDb, today } from '@/lib/db';
import { qtFormData } from '@/lib/qt-data';
import { QtForm } from '@/components/QtForm';
import { InfoEditForm } from '@/components/InfoEditForm';

const d10 = (x: unknown) => (x ? new Date(x as any).toISOString().slice(0, 10) : '');
export default async function EditQt({ params }: { params: { id: string } }) {
  const user = await requirePage(['sales.write', 'quote.own']);
  const db = await getDb();
  const o = (await db.q(`select * from sales_docs where (id::text=$1 or doc_no=$1) and doc_type in ('QT','INV')`, [decodeURIComponent(params.id)]))[0];
  if (!o || !(await canViewSalesDoc(user, o.id))) notFound();
  if (o.doc_type === 'INV') {
    if (!can(user.role, 'sales.write')) notFound();
    if (o.status === 'cancelled') return <div className="panel empty">เอกสารที่ยกเลิกแล้วแก้ไขไม่ได้ (ใช้ปุ่มสร้างซ้ำ)</div>;
    const full = (await db.q<any>('select sales_doc_fully_editable($1) f', [o.id]))[0].f;
    if (!full && !o.is_deposit) return (<>
      <div className="top"><div><h1>แก้ไขใบแจ้งหนี้ {o.doc_no}</h1><p className="sub">มีเอกสารอื่นผูกอยู่ (ใบเสร็จ/ใบวางบิล/ใบลดหนี้/ใบเพิ่มหนี้ ฯลฯ) จึงแก้ได้เฉพาะข้อมูลทั่วไป — วันที่ ลูกค้า รายการ และยอดถูกล็อก</p></div></div>
      <InfoEditForm id={o.id} init={{ ref_no: o.ref_no ?? '', description: o.description ?? '', project: o.project ?? '', note: o.note ?? '', internal_note: o.internal_note ?? '' }} />
    </>);
    if (o.is_deposit) return <div className="panel empty">ใบแจ้งหนี้มัดจำแก้ไขไม่ได้</div>;
  } else if (o.status !== 'pending_approval') return <div className="panel empty">แก้ไขได้เฉพาะใบเสนอราคาที่รออนุมัติ (แก้ใบที่อนุมัติแล้วยังไม่ทดสอบบน FA)</div>;
  const ls = await db.q('select * from sales_doc_lines where doc_id=$1 order by line_no', [o.id]);
  const n = (x: unknown) => String(Number(x));
  const d = await qtFormData();
  const header = { date: d10(o.doc_date), contact: o.contact_id, term_mode: o.term_mode, credit_days: String(o.credit_days), due_date: d10(o.due_date) || d10(o.doc_date),
    salesperson: o.salesperson ?? '', project: o.project ?? '', ref_no: o.ref_no ?? '', description: o.description ?? '', price_mode: o.price_mode,
    warehouse_id: o.warehouse_id ?? '', show_signature: o.show_signature, note: o.note ?? '', internal_note: o.internal_note ?? '' };
  const lines = ls.map(l => ({ product_id: l.product_id ?? '', name: l.description ?? '', detail: l.detail ?? '', unit: l.unit ?? '', qty: n(l.qty), unit_price: n(l.unit_price),
    dtype: l.discount_type, dval: Number(l.discount_value) ? n(l.discount_value) : '', vat: l.vat_exempt ? 'exempt' : n(l.vat_rate ?? 7), wht: n(l.wht_rate) }));
  return (<>
    <div className="top"><div><h1>แก้ไขใบ{o.doc_type === 'INV' ? 'แจ้งหนี้' : 'เสนอราคา'} {o.doc_no}</h1>{o.doc_type === 'INV' && <p className="sub">แก้แล้วระบบแก้ทับใบสำคัญเดิมที่เลขเดิม ปรับสต็อกตามส่วนต่าง และบันทึกค่าก่อน-หลังในประวัติเอกสาร</p>}</div></div>
    <QtForm docType={o.doc_type} canPickSalesperson={user.role === 'super_admin'} id={o.id} {...d} today={today()} salesperson={o.salesperson ?? user.displayName ?? ''} init={{ header, lines: lines as any }}
      canCreateCustomer={can(user.role, 'contact.create')} canCreateProduct={can(user.role, 'master.write') || can(user.role, 'quote.own')} />
  </>);
}
