import ExcelJS from 'exceljs';
import { apiUser } from '@/lib/auth';
import { getDb, today } from '@/lib/db';
import { companyOf, faSheet, faHead, faFormat, send } from '@/lib/fa-xlsx';
import { inventoryRows } from '@/lib/inventory-report';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// GET /reports/inventory/export?date=&wh=&mode=summary|detail → Excel สรุปสินค้าคงเหลือ 2 แบบ (REA 1-11-2026)
export async function GET(req: Request) {
  const au = await apiUser(['reports.read']); if (au instanceof Response) return au;
  const u = new URL(req.url), g = (k: string) => u.searchParams.get(k) ?? '';
  const detail = g('mode') === 'detail';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(g('date')) ? g('date') : today();
  const db = await getDb();
  const wh = g('wh') ? (await db.q<any>(`select id, name from warehouses where id = $1`, [g('wh')]))[0] : null;
  const rows = await inventoryRows(date, wh?.id ?? null, detail);
  const wb = new ExcelJS.Workbook();
  const ws = faSheet(wb, detail ? 'InventoryReport' : 'Inventory Warehouse', 'รายงานสินค้าคงเหลือ', await companyOf(db), date.split('-').reverse().join('/'), detail ? 13 : 7);
  ws.getCell('A4').value = 'ณ วันที่ :';
  ws.addRow(['คลังสินค้า', wh?.name ?? 'คลังทั้งหมด']); ws.mergeCells('B5:D5');
  let total = 0, n = 0;
  if (!detail) {
    faHead(ws, ['ลำดับที่', 'ชื่อสินค้า', 'รหัสสินค้า', 'ราคาสินค้าคงเหลือเฉลี่ยต่อหน่วย', 'จำนวนคงคลัง', 'หน่วยสินค้าหลัก', 'มูลค่า']);
    for (const r of rows) { n++; total += r.value; ws.addRow([n, r.name, r.code, r.avg, r.qty, r.unit, r.value]); }
    ws.addRow([null, null, null, null, null, 'ยอดรวม', total]).font = { bold: true };
    faFormat(ws, [9, 40, 18, 22, 14, 14, 16], [], [4, 5, 7]);
  } else {
    faHead(ws, ['ลำดับที่', 'ชื่อสินค้า', 'รหัสสินค้า', 'คลังสินค้า', 'อ้างอิงใบรับสินค้า', 'จำนวนคงคลัง', 'หน่วยสินค้า', 'เทียบเท่าต่อหน่วยสินค้าหลัก', 'หน่วยสินค้าหลัก', 'ราคาต่อหน่วยตามเอกสาร', 'คงเหลือ (หน่วยสินค้าหลัก)', 'ราคาเฉลี่ย (หน่วยสินค้าหลัก)', 'มูลค่า']);
    for (const r of rows) {
      n++; total += r.value;
      ws.addRow([n, r.name, r.code, wh?.name ?? 'คลังทั้งหมด', null, r.qty, null, null, null, null, null, null, r.value]).font = { bold: true };
      for (const l of r.lots) ws.addRow([null, null, null, null, l.ref, l.qty, r.unit, 1, r.unit, l.unit_price, l.qty, l.unit_price, l.value]);
    }
    ws.addRow([null, null, null, null, null, null, null, null, null, null, null, 'ยอดรวม', total]).font = { bold: true };
    faFormat(ws, [9, 40, 18, 16, 22, 14, 12, 14, 12, 16, 16, 16, 16], [], [6, 8, 10, 11, 12, 13]);
  }
  return send(wb, 'รายงานสินค้าคงเหลือ');
}
