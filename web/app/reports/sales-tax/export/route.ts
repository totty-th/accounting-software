import ExcelJS from 'exceljs';
import { apiUser } from '@/lib/auth';
import { getDb, today } from '@/lib/db';
import { periodRange } from '@/lib/period';
import { taxPeriodLabel, reportPeriod, pickStatuses, SALES_BUCKETS } from '@/lib/report-filter';
import { salesTaxRows, filingInfo } from '@/lib/tax-report';
import { dateIso } from '@/lib/format';
import { STATUS } from '@/lib/status';
import { companyOf, faFormat, send, xDate } from '@/lib/fa-xlsx';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /reports/sales-tax/export?mode=doc|rate|output&period=&from=&to=&st= → Excel รูปแบบเดียวกับไฟล์ FA (REA 25-10-2026)
//  doc    = รายงานภาษีขายตามเอกสาร (SalesTaxReport)      rate = แยกยอดตามอัตราภาษี (…TaxRateBreakdown)
//  output = รายงานภาษีขาย ภ.พ.30 (OutputTaxReport) มีคอลัมน์สถานะการยื่น/รอบยื่น — ไม่รวมใบยกเลิก
export async function GET(req: Request) {
  const au = await apiUser(['reports.read']); if (au instanceof Response) return au;
  const u = new URL(req.url), g = (k: string) => u.searchParams.get(k) ?? undefined;
  const mode = ['rate', 'output'].includes(g('mode') ?? '') ? g('mode')! : 'doc';
  const period = reportPeriod(g('period')), range = periodRange(period, today(), g('from'), g('to'));
  const { sel, list } = pickStatuses(u.searchParams.getAll('st'), SALES_BUCKETS);
  const db = await getDb();
  const all = await salesTaxRows(db, range, list, mode !== 'output' && (sel.length === 0 || list.includes('cancelled')));
  const filing = await filingInfo(db);
  const fs = g('fs');
  const rows = !fs || mode !== 'output' ? all : all.filter(r => (fs === 'filed') === (filing(dateIso(r.date), r.created_at).status === 'ยื่นแบบภาษีแล้ว'));
  const co = await companyOf(db);
  const month = taxPeriodLabel(range);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(mode === 'output' ? 'OutputTaxReport' : 'SalesTaxReport');
  const wide = mode === 'rate' ? 16 : mode === 'output' ? 13 : 12;
  ws.addRow([mode === 'output' ? 'รายงานภาษีขาย' : 'รายงานภาษีขายตามเอกสาร']);
  ws.addRow([`สำหรับงวดภาษี ${month}`]);
  ws.addRow([`ชื่อผู้ประกอบการ ${co.name}`]);
  ws.addRow(['ชื่อสถานที่ประกอบการ ', '', 'สำนักงาน/สาขาเลขที่ สำนักงานใหญ่']);
  ws.mergeCells('A1:I1'); ws.mergeCells('A2:I2'); ws.mergeCells('A3:I3'); ws.mergeCells('D4:E4'); ws.mergeCells('F4:H4');
  ws.getCell('A1').font = { bold: true, size: 14 }; ws.addRow([]);
  const head = ['ลำดับที่', 'วัน/เดือน/ปี', 'เลขที่เอกสาร', 'เลขที่อ้างอิง', 'ชื่อลูกค้า', 'ชื่อโปรเจ็ค', 'เลขผู้เสียภาษี', 'สำนักงานใหญ่/สาขา'];
  const money = [9, 10];
  if (mode === 'rate') head.push('ยอดขายรวมก่อนภาษี', 'ยอดขายสุทธิที่ได้ยกเว้น', 'ยอดขายสุทธิอัตรา 0%', 'ยอดขายสุทธิอัตรา 7%', 'ภาษีมูลค่าเพิ่ม', 'มูลค่า', 'เอกสารอ้างอิงในระบบ', 'สถานะ');
  else head.push('มูลค่า', 'ภาษีมูลค่าเพิ่ม', 'เอกสารอ้างอิงในระบบ', 'สถานะ', ...(mode === 'output' ? ['รอบการยื่นภาษี'] : []));
  const h = ws.addRow(head); h.font = { bold: true }; h.alignment = { wrapText: true, vertical: 'middle' };
  let ts = 0, tv = 0, n = 0;
  for (const r of rows) {
    const cancelled = r.status === 'cancelled', f = filing(dateIso(r.date), r.created_at);
    const st = mode === 'output' ? f.status : STATUS[r.status]?.[0] ?? r.status;
    const base = [++n, xDate(r.date), r.no, r.ref_no ?? '', r.name, r.project ?? '', r.tax_id ?? null, r.branch];
    if (mode === 'rate') ws.addRow([...base, r.sub, 0, 0, r.sub, r.vat, r.sub + r.vat, r.ref_no ?? '', st]);
    else ws.addRow([...base, r.sub, r.vat, r.ref_no ?? '', st, ...(mode === 'output' ? [f.round] : [])]);
    if (!cancelled) { ts += r.sub; tv += r.vat; }
  }
  const tot = mode === 'rate' ? [null, null, null, null, null, null, null, 'ยอดรวมทั้งหมด', ts, 0, 0, ts, tv, ts + tv] : [null, null, null, null, null, null, null, 'ยอดรวมทั้งหมด', ts, tv];
  ws.addRow(tot).font = { bold: true };
  faFormat(ws, [8, 13, 20, 20, 30, 14, 16, 18, 16, 16, 16, 16, 16, 16, 20, 16].slice(0, wide), [2], mode === 'rate' ? [9, 10, 11, 12, 13, 14] : money);
  return send(wb, mode === 'rate' ? 'รายงานภาษีขายตามเอกสาร_แยกอัตราภาษี' : mode === 'output' ? 'รายงานภาษีขาย' : 'รายงานภาษีขายตามเอกสาร');
}
