import { requirePage } from '@/lib/auth';
import { getDb, today } from '@/lib/db';
import { ProductForm } from '@/components/ProductForm';

export default async function NewProduct() {
  await requirePage('master.write');
  const db = await getDb();
  const cats = (await db.q<any>(`select distinct category c from products where category is not null order by 1`)).map(r => r.c);
  const units = (await db.q<any>(`select distinct u from (select base_unit u from products union select unit from product_units) x order by 1`)).map(r => r.u);
  return <><div className="top"><div><h1>สร้างบริการหรือสินค้า</h1></div></div><ProductForm today={today()} categories={cats} units={units} /></>;
}
