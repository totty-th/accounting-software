import { notFound } from 'next/navigation';
import { can } from '@/lib/permissions';
import { requirePage } from '@/lib/auth';
import { getDb, today } from '@/lib/db';
import { poFormData } from '@/lib/po-data';
import { PoForm } from '@/components/PoForm';

const d10 = (x: unknown) => (x ? new Date(x as any).toISOString().slice(0, 10) : '');
export default async function EditPo({ params }: { params: { id: string } }) {
  const user = await requirePage('expenses.write');
  const db = await getDb();
  const o = (await db.q('select * from purchase_orders where id=$1', [params.id]))[0];
  if (!o) notFound();
  if (o.status !== 'pending') return <div className="panel empty">แก้ไขได้เฉพาะใบสั่งซื้อที่รออนุมัติ (แก้ใบที่อนุมัติแล้วยังไม่ทดสอบบน FA)</div>;
  const ls = await db.q('select * from purchase_order_lines where po_id=$1 order by line_no', [params.id]);
  const n = (x: unknown) => String(Number(x));
  const d = await poFormData();
  const header = { date: d10(o.po_date), contact: o.contact_id, credit_days: String(o.credit_days), due_date: d10(o.due_date), purchaser: o.purchaser ?? '',
    project: o.project ?? '', ref_no: o.ref_no ?? '', description: o.description ?? '', price_mode: o.price_mode, warehouse_id: o.warehouse_id ?? '',
    show_signature: o.show_signature, note: o.note ?? '', internal_note: o.internal_note ?? '' };
  const lines = ls.map(l => ({ product_id: l.product_id, description: l.description ?? '', unit: l.unit ?? '', qty: n(l.qty), unit_price: n(l.unit_price),
    dtype: l.discount_type, dval: Number(l.discount_value) ? n(l.discount_value) : '', vat: l.vat_exempt ? 'exempt' : n(l.vat_rate), wht: n(l.wht_rate) }));
  return (<>
    <div className="top"><div><h1>แก้ไขใบสั่งซื้อ {o.po_no}</h1></div></div>
    <PoForm id={params.id} {...d} today={today()} purchaser={o.purchaser ?? ''} init={{ header, lines: lines as any }}
      canCreateVendor={can(user.role, 'contact.create')} canCreateProduct={can(user.role, 'master.write')} />
  </>);
}
