import { notFound } from 'next/navigation';
import { can } from '@/lib/permissions';
import { requirePage, canEditBuyDoc } from '@/lib/auth';
import { getDb, today } from '@/lib/db';
import { poFormData } from '@/lib/po-data';
import { PoForm } from '@/components/PoForm';

const d10 = (x: unknown) => (x ? new Date(x as any).toISOString().slice(0, 10) : '');
// แก้ใบรับสินค้าที่ยังไม่จ่าย: ระบบกลับรายการ UV เดิม (-R) แล้วลงใบใหม่ · กฎล็อกช่องตามผลทดสอบ FA 15-11-2026
export default async function EditRi({ params }: { params: { kind: string; id: string } }) {
  if (params.kind !== 'ri') notFound();
  const user = await requirePage(['expenses.write', 'buy.own']);
  const db = await getDb();
  const o = (await db.q('select * from goods_receipts where id=$1', [params.id]))[0];
  if (!o || !(await canEditBuyDoc(user, 'RI', o.id))) notFound();
  if (!['unpaid', 'approved'].includes(o.status)) return <div className="panel empty">แก้ไขได้เฉพาะใบรับสินค้าที่รออนุมัติหรืออนุมัติแล้ว (จ่ายแล้ว/ไม่อนุมัติต้องรีเซ็ตก่อน)</div>;
  const inSlip = (await db.q(`select 1 from payment_slip_items i join payment_slips s on s.id=i.slip_id where i.doc_type='RI' and i.doc_id=$1 and s.status='active'`, [params.id])).length > 0;
  if (inSlip) return <div className="panel empty">ใบรับสินค้านี้อยู่ในใบเตรียมจ่าย แก้ไขรายการ/ยอดไม่ได้ (ยกเลิกใบเตรียมจ่ายก่อน)</div>;
  if (o.po_id && (o.split_mode === 'percent' || o.split_mode === 'amount')) return <div className="panel empty">แก้รายการของใบรับสินค้าที่แบ่งจาก PO ตาม % / บาท ยังไม่รองรับ (ยังไม่ทดสอบบน FA)</div>;
  const ls = await db.q('select * from goods_receipt_lines where ri_id=$1 order by line_no', [params.id]);
  const n = (x: unknown) => String(Number(x));
  const d = await poFormData();
  const header = { date: d10(o.ri_date), contact: o.contact_id, credit_days: String(o.credit_days ?? 0), due_date: d10(o.due_date), purchaser: o.purchaser ?? '',
    project: o.project ?? '', ref_no: o.ref_no ?? '', description: o.description ?? '', price_mode: o.price_mode ?? 'exclusive', warehouse_id: o.warehouse_id ?? '',
    show_signature: o.show_signature, note: o.note ?? '', internal_note: o.internal_note ?? '' };
  const lines = ls.map(l => ({ line_no: l.line_no, product_id: l.product_id, description: l.description ?? '', unit: l.unit ?? '', stock: l.stock_qty == null ? '' : n(l.stock_qty), qty: n(l.qty), unit_price: n(l.unit_price),
    dtype: l.discount_type ?? 'percent', dval: Number(l.discount_value) ? n(l.discount_value) : '', vat: l.vat_exempt ? 'exempt' : n(l.vat_rate), wht: n(l.wht_rate ?? 0) }));
  return (<>
    <div className="top"><div><h1>แก้ไขใบรับสินค้า {o.ri_no}</h1><p className="sub">บันทึกแล้วระบบกลับรายการใบสำคัญเดิม (-R) และลงใบใหม่ ปรับสต็อกตามจำนวนใหม่{o.po_id && ' · ใบที่แบ่งจาก PO แก้ได้เฉพาะจำนวน (ไม่เกินคงเหลือ)'}</p></div></div>
    <PoForm kind="RI" id={params.id} lockLines={!!o.po_id && o.split_mode === 'qty'} {...d} today={today()} purchaser={o.purchaser ?? ''} init={{ header, lines: lines as any }}
      canCreateVendor={can(user.role, 'contact.create')} canCreateProduct={can(user.role, 'master.write')} />
  </>);
}
