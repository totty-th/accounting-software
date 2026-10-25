import ExcelJS from 'exceljs';
import { apiUser } from '@/lib/auth';
import { getDb, today } from '@/lib/db';
import { periodRange } from '@/lib/period';
import { reportPeriod, pickStatuses, pgArr, SALES_BUCKETS, periodLabel } from '@/lib/report-filter';
import { addAcctSheet, acctDocs, companyOf, faSheet, faHead, faFormat, send, xDate } from '@/lib/fa-xlsx';
import { STATUS } from '@/lib/status';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const TYPES = ['INV', 'CA', 'CN', 'DN'];

// GET /reports/sales/export?mode=summary|detail&period=&from=&to=&type=&st= → Excel รายงานยอดขาย รูปแบบเดียวกับ FA (REA 25-10-2026)
export async function GET(req: Request) {
  const au = await apiUser(['reports.read']); if (au instanceof Response) return au;
  const u = new URL(req.url), g = (k: string) => u.searchParams.get(k) ?? undefined;
  const detail = g('mode') === 'detail';
  const period = reportPeriod(g('period')), range = periodRange(period, today(), g('from'), g('to'));
  const type = TYPES.includes(g('type') ?? '') ? g('type')! : '';
  const { list } = pickStatuses(u.searchParams.getAll('st'), SALES_BUCKETS);
  const withCancel = list.includes('cancelled');
  const db = await getDb();
  const sg = `case when d.doc_type='CN' then -1 else 1 end`;
  const rows = await db.q<any>(`select d.doc_no, d.doc_type, d.doc_date, d.status, d.project, d.note, d.internal_note, d.salesperson, d.ref_no,
      d.subtotal*(${sg}) sub, d.vat*(${sg}) vat, d.total*(${sg}) total, d.discount_total*(${sg}) disc,
      c.business_name, c.contact_name, c.tax_id, c.branch_code, c.branch_name,
      (select r.doc_no from sales_docs r where r.id = d.ref_doc_id) ref_doc,
      (select dep.doc_no from sales_docs dep where d.deposit_net > 0 and dep.ref_doc_id = d.ref_doc_id and dep.is_deposit and dep.status <> 'cancelled' limit 1) dep_doc
    from sales_docs d join contacts c on c.id = d.contact_id
    where d.doc_type = any(array['INV','CA','CN','DN']) and not d.is_deposit ${withCancel ? '' : `and d.status <> 'cancelled'`} and ($1 = '' or d.doc_type = $1)
      and ($2::date is null or d.doc_date >= $2::date) and ($3::date is null or d.doc_date <= $3::date)
      and (cardinality($4::text[]) = 0 or d.status = any($4::text[]))
    order by array_position(array['CA','INV','DN','CN'], d.doc_type), d.doc_date desc, d.doc_no desc`, [type, range?.[0] ?? null, range?.[1] ?? null, pgArr(list)]);
  const co = await companyOf(db), pl = periodLabel(range);
  const wb = new ExcelJS.Workbook();
  const head = detail
    ? ['ลำดับที่', 'วัน/เดือน/ปี', 'เลขที่เอกสาร', 'ชื่อลูกค้า', 'ชื่อโปรเจ็ค', 'เลขผู้เสียภาษี', 'สำนักงานใหญ่/สาขา', 'ขายแยกภาษี', 'ขายรวมภาษี', 'ส่วนลดก่อน VAT', 'ส่วนลดตามเอกสาร', 'มูลค่า', 'ภาษีมูลค่าเพิ่ม', 'ยอดรวมสุทธิ', 'เอกสารอ้างอิงในระบบ', 'เลขที่อ้างอิง', 'เอกสารอ้างอิงรับมัดจำ', 'สถานะ', 'พนักงานขาย', 'หมายเหตุ', 'โน้ต (สำหรับใช้ภายในบริษัท)']
    : ['ลำดับที่', 'เลขที่เอกสาร', 'วัน/เดือน/ปี', 'ชื่อลูกค้า', 'ชื่อโปรเจ็ค', 'เลขผู้เสียภาษี', 'สำนักงานใหญ่/สาขา', 'มูลค่า', 'ภาษีมูลค่าเพิ่ม', 'ยอดรวมสุทธิ', 'เอกสารอ้างอิงในระบบ', 'เลขที่อ้างอิง', 'เอกสารอ้างอิงรับมัดจำ', 'สถานะ', 'พนักงานขาย', 'หมายเหตุ', 'โน้ต (สำหรับใช้ภายในบริษัท)'];
  const ws = faSheet(wb, 'SalesReport', 'รายงานยอดขาย', co, pl, head.length > 17 ? 11 : 10, detail ? 1 : 0);
  faHead(ws, head);
  let a = 0, b = 0, c = 0, dd = 0, ee = 0;
  rows.forEach((r, i) => {
    const party = r.business_name || r.contact_name || '';
    const branch = r.tax_id ? (r.branch_code ? `สาขา ${r.branch_code}${r.branch_name ? ' ' + r.branch_name : ''}` : 'สำนักงานใหญ่') : '';
    const st = STATUS[r.status]?.[0] ?? r.status;
    const common = [r.ref_doc ?? '', r.ref_doc ?? r.ref_no ?? '', r.dep_doc ?? '', st, r.salesperson ?? '', r.note ?? '', r.internal_note ?? ''];
    const live = r.status !== 'cancelled';
    if (detail) {
      const sub = Number(r.sub), disc = Number(r.disc);
      ws.addRow([i + 1, xDate(r.doc_date), r.doc_no, party, r.project ?? '', r.tax_id ?? '', branch, sub + disc, null, 0, disc, sub, Number(r.vat), Number(r.total), ...common]);
      if (live) { a += sub + disc; dd += disc; ee += sub; b += Number(r.vat); c += Number(r.total); }
    } else {
      ws.addRow([i + 1, r.doc_no, xDate(r.doc_date), party, r.project ?? '', r.tax_id ?? '', branch, Number(r.sub), Number(r.vat), Number(r.total), ...common]);
      if (live) { a += Number(r.sub); b += Number(r.vat); c += Number(r.total); }
    }
  });
  const t = detail ? ws.addRow([null, null, null, null, null, null, 'ยอดรวมทั้งหมด', a, 0, dd, dd, ee, b, c]) : ws.addRow([null, null, null, null, null, null, 'ยอดรวมทั้งหมด', a, b, c]);
  t.font = { bold: true };
  if (detail) faFormat(ws, [9, 13, 20, 30, 18, 16, 18, 14, 12, 14, 14, 14, 14, 14, 22, 20, 22, 16, 18, 20, 24], [2], [8, 9, 10, 11, 12, 13, 14]);
  else faFormat(ws, [9, 20, 13, 30, 18, 16, 18, 14, 14, 14, 22, 20, 22, 16, 18, 20, 24], [3], [8, 9, 10]);
  addAcctSheet(wb, 'รายงานยอดขาย', co, pl, await acctDocs(db, 'revenue', range), detail ? 1 : 0);
  return send(wb, detail ? 'รายงานยอดขาย_แบบละเอียด' : 'รายงานยอดขาย');
}
