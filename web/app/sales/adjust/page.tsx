import { notFound } from 'next/navigation';
import { AdjustForm } from '@/components/AdjustForm';
import { loadView } from '@/lib/doc-view';
import { today } from '@/lib/db';
import { createSalesDoc } from '@/lib/actions';
import { DOC_TYPE } from '@/lib/status';

export default async function Adjust({ searchParams }: { searchParams: { type?: string; ref?: string } }) {
  const type = searchParams.type === 'DN' ? 'DN' : 'CN';
  const v = searchParams.ref ? await loadView(searchParams.ref) : null;
  if (!v || v.doc.doc_type !== 'INV' || v.doc.status === 'cancelled') return notFound();
  return (
    <>
      <div className="top"><h1>{DOC_TYPE[type]}ใหม่</h1></div>
      <AdjustForm type={type} refId={v.doc.id} contactId={v.contact.id} refNo={v.doc.doc_no} refTotal={+v.doc.total} refSubtotal={+v.doc.subtotal}
        mode={v.doc.price_mode} rate={+v.doc.vat_rate} today={today()} action={createSalesDoc}
        lines={v.lines.map(l => ({ description: l.description, item_kind: l.item_kind, qty: +l.qty, unit_price: +l.unit_price }))} />
    </>
  );
}
