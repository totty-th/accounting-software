import { getDb } from './db';
import { partyName } from './format';
import type { Vendor, Prod } from '@/components/PoForm';

/** ข้อมูลประกอบฟอร์มใบสั่งซื้อ: ผู้จำหน่าย (พร้อมที่อยู่), สินค้านับสต็อก (พร้อมคงเหลือ), คลัง */
export async function poFormData() {
  const db = await getDb();
  const vendors: Vendor[] = (await db.q(`select id, business_name, contact_name, address, postal_code, tax_id, branch_code, credit_days
      from contacts where not is_cash_default and is_vendor order by business_name nulls last`))
    .map(c => ({ id: c.id, label: partyName(c), address: c.address ?? '', postal: c.postal_code ?? '', tax_id: c.tax_id ?? '',
      branch: c.branch_code ? `สาขา ${c.branch_code}` : 'สำนักงานใหญ่', credit_days: Number(c.credit_days ?? 0) }));
  const products: Prod[] = (await db.q(`select id, code, name, base_unit, purchase_price, stock_on_hand(id) onhand from products where kind='goods_stock' and is_active order by code`))
    .map(p => ({ id: p.id, code: p.code, name: p.name, unit: p.base_unit, price: Number(p.purchase_price), onhand: Number(p.onhand ?? 0) }));
  const warehouses = (await db.q(`select id, code, name from warehouses order by is_main desc, code`)).map(w => ({ id: w.id as string, label: `${w.code} ${w.name}` }));
  return { vendors, products, warehouses };
}
