import ExcelJS from 'exceljs';
import { apiUser } from '@/lib/auth';
import { getDb, today } from '@/lib/db';
import { periodRange } from '@/lib/period';
import { taxPeriodLabel, reportPeriod, pickStatuses, PURCHASE_BUCKETS } from '@/lib/report-filter';
import { purchaseTaxRows, filingInfo, branchLabel } from '@/lib/tax-report';
import { dateIso } from '@/lib/format';
import { STATUS } from '@/lib/status';
import { companyOf, faFormat, send, xDate } from '@/lib/fa-xlsx';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /reports/purchase-tax/export?mode=doc|inputtax|pp36 → Excel
//  inputtax/pp30 = "รายงานภาษีซื้อ(ภ.พ.30)" · pp36 = "รายงานภาษีซื้อ(ภ.พ.36)" ตามไฟล์ FA (REA 25-10-2026)
//  doc = ภาษีซื้อตามเอกสาร — ⚠ ยังไม่ได้เทียบกับไฟล์ FA จริง (ไฟล์ที่ดาวน์โหลดไว้เป็นรายงานเจ้าหนี้) ใช้คอลัมน์เดียวกับหน้าจอ
export async function GET(req: Request) {
  const au = await apiUser(['reports.read']); if (au instanceof Response) return au;
  const u = new URL(req.url), g = (k: string) => u.searchParams.get(k) ?? undefined;
  const m = g('mode') ?? 'doc', mode = m === 'pp36' ? 'pp36' : m === 'inputtax' || m === 'pp30' ? 'pp30' : 'doc';
  const period = reportPeriod(g('period')), range = periodRange(period, today(), g('from'), g('to'));
  const db = await getDb(), co = await companyOf(db), filing = await filingInfo(db);
  const month = taxPeriodLabel(range);
  const wb = new ExcelJS.Workbook();
  const title = mode === 'pp36' ? 'รายงานภาษีซื้อ(ภ.พ.36)' : mode === 'pp30' ? 'รายงานภาษีซื้อ(ภ.พ.30)' : 'รายงานภาษีซื้อตามเอกสาร';
  const ws = wb.addWorksheet(mode === 'pp36' ? 'ForeignInputTaxReport' : mode === 'pp30' ? 'InputTaxReport' : 'PurchaseTaxReport');
  ws.addRow([title]); ws.addRow([`สำหรับงวดภาษี ${month}`]); ws.addRow([`ชื่อผู้ประกอบการ ${co.name}`]); ws.addRow(['ชื่อสถานที่ประกอบการ ', '', 'สำนักงาน/สาขาเลขที่ สำนักงานใหญ่']);
  ws.mergeCells('A1:I1'); ws.mergeCells('A2:I2'); ws.mergeCells('A3:I3'); ws.mergeCells('D4:E4'); ws.mergeCells('F4:H4');
  ws.getCell('A1').font = { bold: true, size: 14 }; ws.addRow([]);
  let ts = 0, tv = 0, n = 0;
  if (mode === 'doc') {
    const { list } = pickStatuses(u.searchParams.getAll('st'), PURCHASE_BUCKETS);
    const rows = await purchaseTaxRows(db, range, list, list.includes('cancelled'));
    ws.addRow(['ลำดับที่', 'วัน/เดือน/ปี', 'เลขที่เอกสาร', 'เลขที่อ้างอิง', 'ชื่อผู้จำหน่าย', 'ชื่อโปรเจ็ค', 'เลขผู้เสียภาษี', 'สำนักงานใหญ่/สาขา', 'มูลค่า', 'ภาษีมูลค่าเพิ่ม', 'สถานะ']).font = { bold: true };
    for (const r of rows) { ws.addRow([++n, xDate(r.date), r.no, r.ref_no ?? '', r.name, '', r.tax_id ?? null, r.branch, r.sub, r.vat, STATUS[r.status]?.[0] ?? r.status]);
      if (!['cancelled', 'rejected'].includes(r.status)) { ts += r.sub; tv += r.vat; } }
  } else {
    // ใบกำกับภาษีที่ได้รับ (EXP/RI) แยกแบบ ภ.พ.30 / ภ.พ.36 — ไม่รวมเอกสารไม่อนุมัติ/ยกเลิก
    const rows = await db.q<any>(`select t.invoice_date, t.invoice_no, t.vendor_name, t.vendor_tax_id, t.branch, t.base_amount, t.vat_amount,
        coalesce(e.exp_no, g.ri_no) doc_no, coalesce(e.created_at, g.created_at) created_at
      from purchase_tax_invoices t left join expenses e on t.doc_type = 'EXP' and e.id = t.doc_id left join goods_receipts g on t.doc_type = 'RI' and g.id = t.doc_id
      where t.vat_form = $3 and ($1::date is null or t.invoice_date >= $1::date) and ($2::date is null or t.invoice_date <= $2::date)
        and coalesce(e.status, g.status) not in ('rejected','cancelled') order by t.invoice_date, t.invoice_no`, [range?.[0] ?? null, range?.[1] ?? null, mode === 'pp36' ? 'PP36' : 'PP30']);
    ws.addRow(['ลำดับที่', 'วันที่ใบกำกับภาษี', 'เลขที่ใบกำกับภาษี', 'เลขที่อ้างอิง', 'ชื่อผู้จำหน่าย', 'ชื่อโปรเจ็ค', 'เลขผู้เสียภาษี', 'สำนักงานใหญ่/สาขา', 'มูลค่า', 'ภาษีมูลค่าเพิ่ม', 'เอกสารอ้างอิงในระบบ', 'สถานะ', ...(mode === 'pp30' ? ['รอบการยื่นภาษี'] : [])]).font = { bold: true };
    for (const r of rows) {
      const f = filing(String(r.invoice_date instanceof Date ? r.invoice_date.toISOString() : r.invoice_date).slice(0, 10), r.created_at);
      ws.addRow([++n, xDate(r.invoice_date), r.invoice_no, r.doc_no, r.vendor_name, '', r.vendor_tax_id ?? null, branchLabel({ branch_code: r.branch && /^[0-9]{5}$/.test(r.branch) ? r.branch : null }), Number(r.base_amount), Number(r.vat_amount), '',
        mode === 'pp36' ? 'รอใบเสร็จสรรพากร' : f.status, ...(mode === 'pp30' ? [f.round] : [])]);
      ts += Number(r.base_amount); tv += Number(r.vat_amount);
    }
  }
  ws.addRow([null, null, null, null, null, null, null, 'ยอดรวมทั้งหมด', ts, tv]).font = { bold: true };
  faFormat(ws, [8, 14, 20, 20, 30, 14, 16, 18, 16, 16, 20, 18, 22], [2], [9, 10]);
  return send(wb, title);
}
