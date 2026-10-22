import { getDb, today } from '@/lib/db';
import { SalesDocForm } from '@/components/DocForm';
import { DOC_TYPE } from '@/lib/status';
import { createSalesDoc } from '@/lib/actions';
import { partyName } from '@/lib/format';

export default async function NewDoc({ searchParams }: { searchParams: { type?: string } }) {
  const type = ['QT', 'INV', 'CA'].includes(searchParams.type ?? '') ? searchParams.type! : 'INV';
  const db = await getDb();
  const customers = (await db.q(`select id, business_name, contact_name from contacts where not is_cash_default order by business_name nulls last`))
    .map(c => ({ id: c.id as string, label: partyName(c) }));
  const products = (await db.q(`select id, code, name, sale_price, kind from products where is_active order by code`))
    .map(p => ({ id: p.id as string, label: `${p.code} ${p.name}`, price: Number(p.sale_price), kind: p.kind as string }));
  return (
    <>
      <div className="top"><h1>{DOC_TYPE[type]}ใหม่</h1></div>
      <SalesDocForm type={type} title={DOC_TYPE[type]} customers={customers} products={products} today={today()} action={createSalesDoc} />
    </>
  );
}
