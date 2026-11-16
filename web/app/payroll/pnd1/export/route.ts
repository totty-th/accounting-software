import ExcelJS from 'exceljs';
import { apiUser } from '@/lib/auth';
import { getDb, today } from '@/lib/db';
import { monthRange, monthTh, pnd1Data } from '@/lib/pnd1';
import { companyOf, faSheet, faHead, faFormat, send, xDate } from '@/lib/fa-xlsx';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// GET /payroll/pnd1/export?m=YYYY-MM → ใบแนบ ภ.ง.ด.1 (Excel)
export async function GET(req: Request) {
  const au = await apiUser(['payroll.read']); if (au instanceof Response) return au;
  const { ym, from, to } = monthRange(new URL(req.url).searchParams.get('m') ?? undefined, today());
  const db = await getDb(), co = await companyOf(db), d = await pnd1Data(db, from, to);
  const wb = new ExcelJS.Workbook();
  const ws = faSheet(wb, 'PND1', 'ใบแนบ ภ.ง.ด.1', co, `เดือนภาษี ${monthTh(ym)}`, 10);
  faHead(ws, ['ลำดับที่', 'เลขประจำตัวผู้เสียภาษี', 'คำนำหน้า', 'ชื่อ', 'ชื่อสกุล', 'วันที่จ่าย', 'จำนวนเงินได้ที่จ่าย', 'ภาษีหัก 40(1)', 'ภาษีหัก 40(2)', 'เงื่อนไข']);
  d.rows.forEach((r, i) => ws.addRow([i + 1, r.tax_id, r.title, r.first_name, r.last_name, xDate(r.date), r.income, r.wht401, r.wht402, 1]));
  ws.addRow([null, null, null, null, null, 'รวม', d.income, d.wht401, d.wht402]).font = { bold: true };
  faFormat(ws, [8, 18, 10, 18, 18, 13, 16, 14, 14, 10], [6], [7, 8, 9]);
  return send(wb, `ภ.ง.ด.1 ${ym}`);
}
