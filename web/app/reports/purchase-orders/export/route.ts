import ExcelJS from 'exceljs';
import { apiUser } from '@/lib/auth';
import { getDb, today } from '@/lib/db';
import { periodRange } from '@/lib/period';
import { reportPeriod, pickStatuses, periodLabel } from '@/lib/report-filter';
import { companyOf, faSheet, faHead, faFormat, send, xDate } from '@/lib/fa-xlsx';
import { PO_BUCKETS, PO_LABEL, branchText, poRows } from '@/lib/purchase-reports';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// GET /reports/purchase-orders/export → Excel รายงานใบสั่งซื้อ (คอลัมน์ตามต้นแบบ REA 1-11-2026)
export async function GET(req: Request) {
  const au = await apiUser(['reports.read']); if (au instanceof Response) return au;
  const u = new URL(req.url), g = (k: string) => u.searchParams.get(k) ?? undefined;
  const period = reportPeriod(g('period')), range = periodRange(period, today(), g('from'), g('to'));
  const { list } = pickStatuses(u.searchParams.getAll('st'), PO_BUCKETS);
  const rows = await poRows(range, list), db = await getDb();
  const wb = new ExcelJS.Workbook();
  const ws = faSheet(wb, 'PurchaseOrderReport', 'รายงานใบสั่งซื้อ', await companyOf(db), periodLabel(range), 13);
  faHead(ws, ['ลำดับที่', 'เลขที่เอกสาร', 'วัน/เดือน/ปี', 'ชื่อผู้จำหน่าย', 'ชื่อโปรเจ็ค', 'เลขผู้เสียภาษี', 'สำนักงานใหญ่/สาขา', 'มูลค่า', 'ภาษีมูลค่าเพิ่ม', 'ยอดรวมสุทธิ', 'เอกสารอ้างอิงในระบบ', 'เลขที่อ้างอิง', 'สถานะ']);
  let n = 0, a = 0, b = 0, c = 0;
  for (const r of rows) {
    n++; a += Number(r.subtotal); b += Number(r.vat); c += Number(r.total);
    ws.addRow([n, r.po_no, xDate(r.po_date), r.business_name || r.contact_name || '', r.project ?? '', r.tax_id ?? '', branchText(r), Number(r.subtotal), Number(r.vat), Number(r.total), r.ris ?? '', r.ref_no ?? '', PO_LABEL[r.status] ?? r.status]);
  }
  const t = ws.addRow([null, null, null, null, null, null, 'ยอดรวมทั้งหมด', a, b, c]); t.font = { bold: true };
  faFormat(ws, [9, 20, 13, 30, 18, 17, 18, 14, 14, 14, 22, 18, 14], [3], [8, 9, 10]);
  return send(wb, 'รายงานใบสั่งซื้อ');
}
