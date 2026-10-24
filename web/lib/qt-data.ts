import { getDb } from './db';
import { partyName } from './format';
import type { Cust, QProd } from '@/components/QtForm';

/** ข้อมูลประกอบฟอร์มใบเสนอราคา: ลูกค้า (พร้อมที่อยู่/เครดิต), สินค้า/บริการ, คลัง, พนักงานขาย */
export async function qtFormData() {
  const db = await getDb();
  const customers: Cust[] = (await db.q(`select id, business_name, contact_name, address, postal_code, tax_id, branch_code, credit_days
      from contacts where not is_cash_default and is_customer order by business_name nulls last`))
    .map(c => ({ id: c.id, label: partyName(c), address: c.address ?? '', postal: c.postal_code ?? '', tax_id: c.tax_id ?? '',
      branch: c.branch_code ? `สาขา ${c.branch_code}` : 'สำนักงานใหญ่', credit_days: Number(c.credit_days ?? 0) }));
  const products: QProd[] = (await db.q(`select id, code, name, base_unit, sale_price, kind, description, case when kind='goods_stock' then stock_on_hand(id) else 0 end onhand from products where is_active order by code`))
    .map(p => ({ id: p.id, code: p.code, name: p.name, unit: p.base_unit ?? '', price: Number(p.sale_price ?? 0), kind: p.kind, onhand: Number(p.onhand ?? 0), description: p.description ?? '' }));
  const warehouses = (await db.q(`select id, code, name from warehouses order by is_main desc, code`)).map(w => ({ id: w.id as string, label: `${w.code} ${w.name}` }));
  const people = (await db.q(`select display_name from app_users where is_active order by display_name`)).map(u => u.display_name as string);
  return { customers, products, warehouses, people };
}
