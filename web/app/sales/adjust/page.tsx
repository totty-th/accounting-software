import { requirePage } from '@/lib/auth';
import { notFound } from 'next/navigation';
import { AdjustForm } from '@/components/AdjustForm';
import { loadView } from '@/lib/doc-view';
import { today, getDb } from '@/lib/db';
import { createSalesDoc } from '@/lib/actions';
import { DOC_TYPE } from '@/lib/status';

export default async function Adjust({ searchParams }: { searchParams: { type?: string; ref?: string } }) {
  await requirePage('sales.write');
  const type = searchParams.type === 'DN' ? 'DN' : 'CN';
  const v = searchParams.ref ? await loadView(searchParams.ref) : null;
  if (!v || v.doc.doc_type !== 'INV' || v.doc.status === 'cancelled') return notFound();
  const meta = await (await getDb()).q<{ line_no: number; product_id: string | null; is_stock: boolean }>(
    `select l.line_no, l.product_id, coalesce(p.kind = 'goods_stock', false) as is_stock
       from sales_doc_lines l left join products p on p.id = l.product_id where l.doc_id = $1 order by l.line_no`, [v.doc.id]);
  return (
    <>
      <div className="top"><h1>{DOC_TYPE[type]}ใหม่</h1></div>
      <AdjustForm type={type} refId={v.doc.id} contactId={v.contact.id} refNo={v.doc.doc_no} refTotal={+v.doc.total} refSubtotal={+v.doc.subtotal}
        mode={v.doc.price_mode} rate={+v.doc.vat_rate} today={today()} action={createSalesDoc}
        lines={v.lines.map(l => ({ description: l.description, item_kind: l.item_kind, qty: +l.qty, unit_price: +l.unit_price,
          product_id: meta.find(m => m.line_no === l.line_no)?.product_id ?? null,
          is_stock: meta.find(m => m.line_no === l.line_no)?.is_stock ?? false }))} />
    </>
  );
}
