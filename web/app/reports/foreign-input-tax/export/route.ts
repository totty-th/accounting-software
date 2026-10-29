import ExcelJS from 'exceljs';
import { apiUser } from '@/lib/auth';
import { getDb, today } from '@/lib/db';
import { periodRange } from '@/lib/period';
import { taxPeriodLabel } from '@/lib/report-filter';
import { inputTaxPp36Rows } from '@/lib/tax-report';
import { companyOf, faFormat, send, xDate } from '@/lib/fa-xlsx';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /reports/foreign-input-tax/export?period=month|lastmonth&fs=wait|paid → "รายงานภาษีซื้อ(ภ.พ.36)" รูปแบบไฟล์ FA (REA 29-10-2026): มีวันที่/เลขที่ใบเสร็จสรรพากร
export async function GET(req: Request) {
  const au = await apiUser(['reports.read']); if (au instanceof Response) return au;
  const u = new URL(req.url), g = (k: string) => u.searchParams.get(k) ?? undefined;
  const range = periodRange(g('period') === 'lastmonth' ? 'lastmonth' : 'month', today());
  const fs = ['wait', 'paid'].includes(g('fs') ?? '') ? g('fs')! : '';
  const db = await getDb(), co = await companyOf(db);
  const rows = await inputTaxPp36Rows(db, range, fs);
  const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet('ForeignInputTaxReport');
  ws.addRow(['รายงานภาษีซื้อ(ภ.พ.36)']); ws.addRow([`สำหรับงวดภาษี ${taxPeriodLabel(range)}`]); ws.addRow([`ชื่อผู้ประกอบการ ${co.name}`]); ws.addRow(['', '', 'ชื่อสถานที่ประกอบการ ', '', '', 'สำนักงาน/สาขาเลขที่ สำนักงานใหญ่']);
  ws.mergeCells('A1:N1'); ws.mergeCells('A2:N2'); ws.mergeCells('A3:N3'); ws.mergeCells('D4:E4'); ws.mergeCells('F4:H4');
  ws.getCell('A1').font = { bold: true, size: 14 }; ws.addRow([]);
  ws.addRow(['ลำดับที่', 'วันที่ใบกำกับภาษี', 'เลขที่ใบกำกับภาษี', 'เลขที่อ้างอิง', 'วันที่ใบเสร็จ', 'เลขที่ใบเสร็จ', 'ชื่อผู้จำหน่าย', 'ชื่อโปรเจ็ค', 'เลขผู้เสียภาษี', 'สำนักงานใหญ่/สาขา', 'มูลค่า', 'ภาษีมูลค่าเพิ่ม', 'เอกสารอ้างอิงในระบบ', 'สถานะ']).font = { bold: true };
  let n = 0, tb = 0, tv = 0;
  for (const r of rows) { ws.addRow([++n, xDate(r.date), r.no, r.doc_no ?? '', r.rd_date ? xDate(r.rd_date) : '', r.rd_no ?? '', r.name, r.project ?? '', r.tax_id ?? null, r.branch, r.base, r.vat, '', r.status]); tb += r.base; tv += r.vat; }
  ws.addRow([null, null, null, null, null, null, null, null, null, 'ยอดรวมทั้งหมด', tb, tv]).font = { bold: true };
  faFormat(ws, [8, 14, 20, 20, 14, 18, 30, 14, 16, 18, 16, 16, 20, 18], [2, 5], [11, 12]);
  return send(wb, 'รายงานภาษีซื้อ_ภพ36');
}
