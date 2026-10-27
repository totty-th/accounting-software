import { requirePage } from '@/lib/auth';
import { getDb, today } from '@/lib/db';
import { TransferForm } from '@/components/TransferForm';

export const dynamic = 'force-dynamic';
export default async function NewTransfer() {
  await requirePage('master.write');
  const db = await getDb();
  const whs = await db.q<any>('select id, name from warehouses order by is_main desc, code');
  const ps = await db.q<any>(`select p.id, p.code, p.name, p.base_unit unit, p.purchase_price::float8 buy, p.block_negative block,
      coalesce((select jsonb_object_agg(warehouse_id, q) from (select warehouse_id, sum(qty_in-qty_out)::float8 q from stock_movements where product_id=p.id and voided_at is null group by 1) x), '{}') "byWh"
    from products p where p.kind='goods_stock' and p.is_active order by p.code`);
  return <><div className="top"><div><h1>สร้างใบโอนสินค้า</h1></div></div><TransferForm today={today()} whs={whs} products={ps} /></>;
}
