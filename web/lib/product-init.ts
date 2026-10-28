import { getDb } from './db';
import type { ProductInit } from '@/components/ProductForm';

/** ข้อมูลตั้งต้นฟอร์มสินค้า (แก้ไข/สร้างซ้ำ) · สร้างซ้ำ = รหัสว่างให้กรอกใหม่ */
export async function productInit(id: string, dup: boolean): Promise<ProductInit | undefined> {
  const db = await getDb();
  const [p] = await db.q<any>('select * from products where id::text = $1', [id]);
  if (!p) return undefined;
  const us = await db.q<any>('select * from product_units where product_id = $1 order by factor', [p.id]);
  return { kind: p.kind, name: dup ? `${p.name} (สำเนา)` : p.name, code: dup ? '' : p.code, category: p.category ?? '', unit: p.base_unit, barcode: dup ? '' : p.barcode ?? '',
    sale: String(Number(p.sale_price)), buy: String(Number(p.purchase_price)), block: p.block_negative,
    description: p.description ?? '', saleVat: p.sale_vat_mode, buyVat: p.purchase_vat_mode, goodsType: p.goods_type, lowMode: p.low_stock_mode,
    low: Object.fromEntries((await db.q<any>('select warehouse_id, min_qty from product_low_stock where product_id=$1', [p.id])).map(l => [l.warehouse_id, String(Number(l.min_qty))])),
    units: us.map(u => ({ unit: u.unit, factor: String(Number(u.factor)), sale: String(Number(u.sale_price ?? 0)), buy: String(Number(u.purchase_price ?? 0)), barcode: u.barcode ?? '' })) };
}
