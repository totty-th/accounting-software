import ExcelJS from 'exceljs';
import { apiUser } from '@/lib/auth';
import { getDb, today } from '@/lib/db';
import { periodRange } from '@/lib/period';
import { reportPeriod, pickStatuses, periodLabel } from '@/lib/report-filter';
import { whtRows, WHT_ST } from '@/lib/tax-report';
import { companyOf, faSheet, faHead, faFormat, send, xDate } from '@/lib/fa-xlsx';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const BUCKETS: Record<string, string[]> = { done: ['active'], cancelled: ['cancelled'] };

// GET /reports/wht/export → "รายงานภาษีหัก ณ ที่จ่าย" รูปแบบเดียวกับไฟล์ FA (14 คอลัมน์)
// หมายเหตุ: คอลัมน์ "อัตราภาษี" ในไฟล์ FA แสดงตัวเลขภาษีที่หักเป็นข้อความ (เหมือนจะเป็นบั๊กของ FA) — ของเราแสดงอัตราจริง (%)
export async function GET(req: Request) {
  const au = await apiUser(['reports.read']); if (au instanceof Response) return au;
  const u = new URL(req.url), g = (k: string) => u.searchParams.get(k) ?? undefined;
  const period = reportPeriod(g('period')), range = periodRange(period, today(), g('from'), g('to'));
  const { list } = pickStatuses(u.searchParams.getAll('st'), BUCKETS);
  const db = await getDb(), co = await companyOf(db);
  const rows = await whtRows(db, range, list);
  const wb = new ExcelJS.Workbook();
  const ws = faSheet(wb, 'WithholdingTaxReport', 'รายงานภาษีหัก ณ ที่จ่าย', co, periodLabel(range), 14);
  faHead(ws, ['ลำดับที่', 'เลขผู้เสียภาษี', 'เลขที่เอกสาร', 'ผู้ถูกหัก ณ ที่จ่าย', 'ที่อยู่', 'สำนักงาน/สาขาเลขที่', 'วัน/เดือน/ปี', 'ประเภทเงินได้ที่จ่าย', 'อัตราภาษี', 'มูลค่า', 'ภาษีที่หัก', 'ใบแนบ', 'อ้างอิง', 'สถานะ']);
  rows.forEach((r, i) => ws.addRow([i + 1, r.tax_id ?? '', r.no, r.name, r.address ?? '', r.branch, xDate(r.date), r.income,
    r.base ? `${(Math.round(r.wht / r.base * 10000) / 100).toString()}%` : '', r.base, r.wht, r.form, r.exp_no ?? '', WHT_ST[r.status] ?? r.status]));
  const live = rows.filter(r => r.status === 'active');
  ws.addRow([null, null, null, null, null, null, null, null, 'ยอดรวมทั้งหมด', live.reduce((a, r) => a + r.base, 0), live.reduce((a, r) => a + r.wht, 0)]).font = { bold: true };
  faFormat(ws, [8, 16, 20, 30, 30, 18, 13, 40, 12, 14, 14, 12, 20, 14], [7], [10, 11]);
  return send(wb, 'รายงานภาษีหัก ณ ที่จ่าย');
}
