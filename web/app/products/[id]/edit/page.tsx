import { notFound } from 'next/navigation';
import { requirePage } from '@/lib/auth';
import { getDb, today } from '@/lib/db';
import { ProductForm } from '@/components/ProductForm';
import { productInit } from '@/lib/product-init';

export default async function EditProduct({ params }: { params: { id: string } }) {
  await requirePage('master.write');
  const db = await getDb();
  const init = await productInit(params.id, false); if (!init) notFound();
  const [p] = await db.q<any>('select id from products where id::text=$1', [params.id]);
  const cats = (await db.q<any>(`select distinct category c from products where category is not null order by 1`)).map(r => r.c);
  const units = (await db.q<any>(`select distinct u from (select base_unit u from products union select unit from product_units) x order by 1`)).map(r => r.u);
  return <><div className="top"><div><h1>แก้ไขสินค้า</h1></div></div><ProductForm today={today()} categories={cats} units={units} init={init} editId={p.id} /></>;
}
