import { notFound } from 'next/navigation';
import { requirePage } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { money, dateTh, dateIso } from '@/lib/format';
import { VatReceiveSheet, type RecvRow } from '@/components/VatReceiveSheet';

export const dynamic = 'force-dynamic';
export default async function Receive({ searchParams }: { searchParams: { ids?: string } }) {
  await requirePage('accounts.write');
  const ids = (searchParams.ids ?? '').split(',').map(x => x.split(':')).filter(x => ['EXP', 'RI'].includes(x[0]) && /^[0-9a-f-]{36}$/.test(x[1] ?? ''));
  if (!ids.length) notFound();
  const db = await getDb();
  const rows: RecvRow[] = [];
  for (const [type, id] of ids) {
    const [d] = await db.q<any>(type === 'EXP'
      ? `select e.exp_no no, e.exp_date date, e.subtotal sub, e.vat, c.tax_id, coalesce(c.business_name, c.contact_name) name, c.branch_code from expenses e join contacts c on c.id = e.contact_id where e.id = $1 and e.status not in ('rejected','cancelled')`
      : `select g.ri_no no, g.ri_date date, g.subtotal sub, g.vat, c.tax_id, coalesce(c.business_name, c.contact_name) name, c.branch_code from goods_receipts g join contacts c on c.id = g.contact_id where g.id = $1 and g.status not in ('rejected','cancelled')`, [id]);
    if (!d) continue;
    const [t] = await db.q<any>('select invoice_no, invoice_date::text idt, vat_form from purchase_tax_invoices where doc_type=$1 and doc_id=$2', [type, id]);
    rows.push({ type, id, no: d.no, dateTxt: dateTh(d.date), vendor: d.name, taxId: d.tax_id ?? '', branch: d.branch_code && d.branch_code !== '00000' ? `สาขา ${d.branch_code}` : '', amtTxt: money(Number(d.sub)), vatTxt: money(Number(d.vat)),
      invDate: t?.idt ?? dateIso(d.date), invNo: t?.invoice_no ?? '', form: t?.vat_form ?? 'PP30' });
  }
  if (!rows.length) notFound();
  return <VatReceiveSheet rows={rows} />;
}
