import { requirePage } from '@/lib/auth';
import { getDb, today } from '@/lib/db';
import { ProductForm } from '@/components/ProductForm';
import { productInit } from '@/lib/product-init';

export default async function NewProduct({ searchParams }: { searchParams: { from?: string } }) {
  await requirePage('master.write');
  const db = await getDb();
  const cats = (await db.q<any>(`select distinct category c from products where category is not null order by 1`)).map(r => r.c);
  const whs = (await db.q<any>('select id, name, is_main, low_stock_min from warehouses order by is_main desc, code')).map(w => ({ ...w, low_stock_min: w.low_stock_min == null ? null : Number(w.low_stock_min) }));
  const units = (await db.q<any>(`select distinct u from (select base_unit u from products union select unit from product_units) x order by 1`)).map(r => r.u);
  const init = searchParams.from ? await productInit(searchParams.from, true) : undefined;      // สร้างซ้ำ: คัดลอกข้อมูล เว้นรหัสให้กรอกใหม่
  return <><div className="top"><div><h1>{init ? 'สร้างซ้ำสินค้า' : 'สร้างบริการหรือสินค้า'}</h1></div></div><ProductForm today={today()} categories={cats} units={units} init={init} whs={whs} /></>;
}
