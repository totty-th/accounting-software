import ExcelJS from 'exceljs';
import { apiUser } from '@/lib/auth';
import { getDb, today } from '@/lib/db';
import { periodRange } from '@/lib/period';
import { reportPeriod, periodLabel } from '@/lib/report-filter';
import { companyOf, faSheet, faHead, faFormat, send, xDate } from '@/lib/fa-xlsx';
import { groupByProduct, riLines } from '@/lib/purchase-reports';
import { KIND_LABEL } from '@/lib/stock-labels';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const LABEL: Record<string, string> = { pending: 'รออนุมัติ', unpaid: 'รออนุมัติ', approved: 'อนุมัติแล้ว', paid: 'ชำระเงินแล้ว' };
// GET /reports/receiving-by-product/export?mode=summary|detail → Excel ใบรับสินค้าแยกตามสินค้า (2 แบบตามต้นแบบ REA 1-11-2026)
// สรุป: 1 แถว/สินค้า (ราคาเฉลี่ยต่อหน่วย = มูลค่า ÷ จำนวน) · ละเอียด: หัวสินค้า → แถวเอกสาร → ยอดรวมสินค้า
export async function GET(req: Request) {
  const au = await apiUser(['reports.read']); if (au instanceof Response) return au;
  const u = new URL(req.url), g = (k: string) => u.searchParams.get(k) ?? undefined;
  const detail = g('mode') === 'detail';
  const range = periodRange(reportPeriod(g('period')), today(), g('from'), g('to'));
  const db = await getDb();
  const lines = await riLines(range, { kind: g('kind'), wh: g('wh'), product: g('product') });
  const groups = groupByProduct(lines);
  const whName = g('wh') ? (await db.q<any>(`select name from warehouses where id = $1`, [g('wh')]))[0]?.name ?? '' : 'คลังทั้งหมด';
  const wb = new ExcelJS.Workbook();
  const ws = faSheet(wb, 'ReceivingInventoryByProductRepo', 'รายงานใบรับสินค้าแยกตามสินค้า', await companyOf(db), periodLabel(range), detail ? 18 : 11);
  ws.addRow(['คลังสินค้า :', whName]); ws.mergeCells('B5:D5');
  if (!detail) {
    faHead(ws, ['รหัสสินค้า', 'ชื่อสินค้า', 'จำนวน', 'หน่วยสินค้าตามเอกสาร', 'เทียบเท่าต่อหน่วยสินค้าหลัก', 'หน่วยสินค้าหลัก', 'ราคาเฉลี่ยต่อหน่วย', 'มูลค่า', 'ภาษีมูลค่าเพิ่ม', 'ยอดรวมสุทธิ', 'หมวดสินค้า']);
    for (const p of groups) ws.addRow([p.code, p.name, p.qty, p.unit, p.qty, p.unit, p.qty ? Math.round(p.net / p.qty * 100) / 100 : 0, p.net, p.vat, Math.round((p.net + p.vat) * 100) / 100, p.cat]);
    faFormat(ws, [14, 34, 10, 14, 14, 12, 14, 14, 14, 14, 18], [], [3, 5, 7, 8, 9, 10]);
  } else {
    faHead(ws, ['รหัสสินค้า', 'เลขที่เอกสาร', 'คลังสินค้า', 'วัน/เดือน/ปี', 'ชื่อผู้จำหน่าย', 'จำนวน', 'หน่วยสินค้า', 'เทียบเท่าต่อหน่วยสินค้าหลัก', 'หน่วยสินค้าหลัก', 'ราคาต่อหน่วย', 'มูลค่าก่อนส่วนลด',
      'ส่วนลดต่อหน่วย', 'ส่วนลดรวม', 'ราคาต่อหน่วยหลังส่วนลด', 'มูลค่า', 'ภาษีมูลค่าเพิ่ม', 'ยอดรวมสุทธิ', 'สถานะ']);
    for (const p of groups) {
      const h = ws.addRow([p.code, p.name]); h.font = { bold: true };
      for (const r of p.rows) {
        const q = Number(r.qty), gross = Math.round(q * Number(r.unit_price) * 100) / 100, disc = Number(r.discount ?? 0);
        ws.addRow(['', r.ri_no, r.wh_name, xDate(r.ri_date), r.business_name || r.contact_name || '', q, r.unit_name ?? '', q, r.unit_name ?? '', Number(r.unit_price), gross,
          q ? Math.round(disc / q * 100) / 100 : 0, disc, q ? Math.round((gross - disc) / q * 100) / 100 : 0, Number(r.net), Number(r.vat), Math.round((Number(r.net) + Number(r.vat)) * 100) / 100, LABEL[r.status] ?? r.status]);
      }
      const t = ws.addRow(['ยอดรวม', p.qty]); t.font = { bold: true }; t.getCell(15).value = p.net; t.getCell(16).value = p.vat; t.getCell(17).value = Math.round((p.net + p.vat) * 100) / 100;
    }
    faFormat(ws, [14, 22, 16, 13, 28, 10, 12, 14, 12, 12, 14, 12, 12, 14, 14, 14, 14, 14], [4], [6, 8, 10, 11, 12, 13, 14, 15, 16, 17]);
  }
  void KIND_LABEL;
  return send(wb, 'รายงานใบรับสินค้าแยกตามสินค้า');
}
