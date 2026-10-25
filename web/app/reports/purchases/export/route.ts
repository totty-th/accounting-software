import ExcelJS from 'exceljs';
import { apiUser } from '@/lib/auth';
import { getDb, today } from '@/lib/db';
import { periodRange } from '@/lib/period';
import { reportPeriod, pickStatuses, pgArr, PURCHASE_BUCKETS, periodLabel } from '@/lib/report-filter';
import { addAcctSheet, acctDocs, companyOf, faSheet, faHead, faFormat, send, xDate } from '@/lib/fa-xlsx';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const LABEL: Record<string, string> = { pending: 'รออนุมัติ', unpaid: 'รออนุมัติ', approved: 'อนุมัติแล้ว', paid: 'ชำระเงินแล้ว', rejected: 'ไม่อนุมัติ', cancelled: 'ยกเลิก' };

// GET /reports/purchases/export?mode=summary|detail&period=&from=&to=&kind=&st= → Excel รายงานค่าใช้จ่าย รูปแบบเดียวกับ FA (REA 25-10-2026)
// แบบละเอียด: เอกสารค่าใช้จ่ายมีแถวรายการย่อย + ยอดรวมต่อเอกสาร (ใบรับสินค้าเป็นแถวเดียว)
export async function GET(req: Request) {
  const au = await apiUser(['reports.read']); if (au instanceof Response) return au;
  const u = new URL(req.url), g = (k: string) => u.searchParams.get(k) ?? undefined;
  const detail = g('mode') === 'detail';
  const period = reportPeriod(g('period')), range = periodRange(period, today(), g('from'), g('to'));
  const kind = ['RI', 'EXP'].includes(g('kind') ?? '') ? g('kind')! : '';
  const { list } = pickStatuses(u.searchParams.getAll('st'), PURCHASE_BUCKETS);
  const withCancel = list.includes('cancelled');
  const db = await getDb();
  const a = [range?.[0] ?? null, range?.[1] ?? null];
  const docs = await db.q<any>(`select d.*, c.business_name, c.contact_name from (
      select 'RI' k, g.id, g.ri_no no, g.ri_date dt, g.contact_id, g.status, g.subtotal net, g.vat, g.total, g.project, g.note, g.internal_note, g.ref_no,
             (select po.po_no from purchase_orders po where po.id = g.po_id) po_no
        from goods_receipts g
      union all
      select 'EXP', e.id, e.exp_no, e.exp_date, e.contact_id, e.status, e.subtotal, e.vat, e.total, e.project, e.note, e.internal_note, e.ref_no, null
        from expenses e) d
    join contacts c on c.id = d.contact_id
    where ($1::date is null or d.dt >= $1::date) and ($2::date is null or d.dt <= $2::date)
      and ${withCancel ? 'true' : `d.status not in ('rejected','cancelled')`} and (cardinality($3::text[]) = 0 or d.status = any($3::text[])) ${kind ? `and d.k = '${kind}'` : ''}
    order by d.k desc, d.dt desc, d.no desc`, [...a, pgArr(list)]);
  const ids = `{${docs.map(d => d.id).join(',')}}`;
  const lines = docs.length ? await db.q<any>(`select l.expense_id id, l.line_no, l.description d, coalesce(nullif(l.category, ''), ac.name, l.account_code) cat, l.net, l.vat
      from expense_lines l left join accounts ac on ac.code = l.account_code where l.expense_id = any($1::uuid[]) order by l.expense_id, l.line_no`, [ids]) : [];
  const slips = docs.length ? await db.q<any>(`select x.doc_id id, s.pay_no from payment_slip_items x join payment_slips s on s.id = x.slip_id where s.status = 'active' and x.doc_id = any($1::uuid[]) order by s.pay_no`, [ids]) : [];
  const co = await companyOf(db), pl = periodLabel(range);
  const wb = new ExcelJS.Workbook();
  const head = detail
    ? ['ลำดับที่', 'วัน/เดือน/ปี', 'เลขที่เอกสาร', 'เลขผู้เสียภาษี', 'ชื่อผู้จำหน่าย', 'ชื่อโปรเจ็ค/รายละเอียด', 'สำนักงานใหญ่/สาขา', 'ประเภทค่าใช้จ่าย', 'มูลค่า', 'ภาษีมูลค่าเพิ่ม', 'ยอดรวมสุทธิ', 'เอกสารอ้างอิงในระบบ', 'เลขที่อ้างอิง', 'สถานะ', 'หมายเหตุ', 'โน้ต (สำหรับใช้ภายในบริษัท)']
    : ['ลำดับที่', 'วัน/เดือน/ปี', 'เลขที่เอกสาร', 'เลขผู้เสียภาษี', 'ชื่อผู้จำหน่าย', 'ชื่อโปรเจ็ค', 'สำนักงานใหญ่/สาขา', 'มูลค่า', 'ภาษีมูลค่าเพิ่ม', 'ยอดรวมสุทธิ', 'ประเภทค่าใช้จ่าย', 'เอกสารอ้างอิงในระบบ', 'เลขที่อ้างอิง', 'สถานะ', 'หมายเหตุ', 'โน้ต (สำหรับใช้ภายในบริษัท)'];
  const ws = faSheet(wb, detail ? 'ExpenseReportAdvance' : 'ExpenseReport', detail ? 'รายงานค่าใช้จ่าย (แบบละเอียด)' : 'รายงานค่าใช้จ่าย', co, pl, detail ? 11 : 10);
  faHead(ws, head);
  const cmeta = await db.q<any>(`select id, tax_id, branch_code, branch_name from contacts where id = any($1::uuid[])`, [`{${[...new Set(docs.map(d => d.contact_id))].join(',')}}`]);
  const cm = new Map(cmeta.map(c => [c.id, c]));
  let sn = 0, tn = 0, tv = 0, tt = 0;
  for (const d of docs) {
    const c = cm.get(d.contact_id) ?? {}, party = d.business_name || d.contact_name || '';
    const branch = c.tax_id ? (c.branch_code ? `สาขา ${c.branch_code}${c.branch_name ? ' ' + c.branch_name : ''}` : 'สำนักงานใหญ่') : 'สำนักงานใหญ่';
    const ls = lines.filter(l => l.id === d.id);
    const cats = d.k === 'EXP' ? [...new Set(ls.map(l => l.cat))].join(', ') : ' ';
    const refs = [...slips.filter(s => s.id === d.id).map(s => s.pay_no), ...(d.po_no ? [d.po_no] : [])].join(',');
    const live = !['rejected', 'cancelled'].includes(d.status);
    if (live) { tn += Number(d.net); tv += Number(d.vat); tt += Number(d.total); }
    sn++;
    const tail = [LABEL[d.status] ?? d.status, d.note ?? '', d.internal_note ?? ''];
    if (detail) {
      const showLines = d.k === 'EXP';
      ws.addRow([sn, xDate(d.dt), d.no, c.tax_id ?? '', party, d.project ?? '', branch, '', showLines ? null : Number(d.net), showLines ? null : Number(d.vat), showLines ? null : Number(d.total), refs, d.po_no ?? d.ref_no ?? '', ...tail]);
      if (showLines) {
        ls.forEach(l => ws.addRow([null, null, null, null, null, l.d, null, l.cat, Number(l.net), Number(l.vat), Number(l.net) + Number(l.vat)]));
        const tr = ws.addRow([null, null, null, null, null, null, null, 'ยอดรวม', Number(d.net), Number(d.vat), Number(d.total)]); tr.font = { bold: true };
        ws.addRow([]);
      }
    } else {
      ws.addRow([sn, xDate(d.dt), d.no, c.tax_id ?? '', party, d.project ?? '', branch, Number(d.net), Number(d.vat), Number(d.total), cats, refs, d.po_no ?? d.ref_no ?? '', ...tail]);
    }
  }
  const t = detail ? ws.addRow([null, null, null, null, null, null, null, 'ยอดรวมทั้งหมด', tn, tv, tt]) : ws.addRow([null, null, null, null, null, null, 'ยอดรวมทั้งหมด', tn, tv, tt]);
  t.font = { bold: true };
  if (detail) faFormat(ws, [9, 13, 20, 16, 32, 30, 18, 24, 14, 14, 14, 26, 20, 16, 20, 24], [2], [9, 10, 11]);
  else faFormat(ws, [9, 13, 20, 16, 32, 18, 18, 14, 14, 14, 24, 26, 20, 16, 20, 24], [2], [8, 9, 10]);
  addAcctSheet(wb, 'รายงานค่าใช้จ่าย', co, pl, await acctDocs(db, 'expense', range));
  return send(wb, detail ? 'รายงานค่าใช้จ่าย_แบบละเอียด' : 'รายงานค่าใช้จ่าย');
}
