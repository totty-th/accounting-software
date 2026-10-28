import ExcelJS from 'exceljs';
import { apiUser } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { getDb } from '@/lib/db';
import { send } from '@/lib/fa-xlsx';
import { KIND_LABEL } from '@/lib/stock-labels';
import { productQuery } from '@/lib/product-list';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /products/export?ids=a,b&kind=&wh=&q= → Excel รายการสินค้า (เลือกบางรายการ = ids · ไม่เลือก = ตามตัวกรองที่เห็น)
export async function GET(req: Request) {
  const au = await apiUser('master.read'); if (au instanceof Response) return au;
  const u = new URL(req.url), g = (k: string) => u.searchParams.get(k) ?? '';
  const ids = g('ids').split(',').filter(x => /^[0-9a-f-]{36}$/.test(x));
  const db = await getDb();
  const rows = await productQuery(db, { kind: g('kind'), q: g('q'), wh: g('wh'), sort: g('sort'), dir: g('dir'), ids });
  const cost = can(au.role, 'cost.view');
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Products');
  ws.addRow(['ประเภทสินค้า', 'รหัสสินค้า', 'ชื่อสินค้า', 'หน่วยสินค้าหลัก', 'หมวดสินค้า', 'เลขบาร์โค้ด', 'รายละเอียดสินค้า', 'ราคาขาย', ...(cost ? ['ราคาซื้อ'] : []), 'จำนวนคงคลัง']).font = { bold: true };
  for (const r of rows) ws.addRow([KIND_LABEL[r.kind], r.code, r.name, r.base_unit, r.category ?? '', r.barcode ?? '', r.description ?? '', Number(r.sale_price), ...(cost ? [Number(r.purchase_price)] : []), r.onhand == null ? null : Number(r.onhand)]);
  ws.columns.forEach(c => { c.width = 22; });
  ws.getColumn(3).width = 44;
  return send(wb, 'รายการสินค้า');
}
