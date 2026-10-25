import ExcelJS from 'exceljs';

export const DATE_FMT = 'dd/mm/yyyy';
export const NUM_FMT = '#,##0.00';
const d = (s: unknown) => (!s ? null : s instanceof Date ? new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate())) : new Date(`${String(s).slice(0, 10)}T00:00:00Z`));
export const xDate = d;

/** หัวไฟล์รายงานแบบ FA: ชื่อรายงาน / ชื่อบริษัท / เลขผู้เสียภาษี / ช่วงเวลา แล้วเว้นบรรทัดตามต้องการ */
export function faSheet(wb: ExcelJS.Workbook, sheet: string, title: string, co: { name: string; tax_id: string }, period: string, titleCols: number, blankAfter = 0) {
  const ws = wb.addWorksheet(sheet);
  ws.addRow([title]); ws.mergeCells(1, 1, 1, titleCols); ws.getCell('A1').font = { bold: true, size: 14 };
  ws.addRow(['ชื่อบริษัท', co.name]); ws.mergeCells('B2:D2');
  ws.addRow(['เลขผู้เสียภาษี :', co.tax_id]); ws.mergeCells('B3:D3');
  ws.addRow(['ช่วงเวลา :', period]); ws.mergeCells('B4:D4');
  for (let i = 0; i < blankAfter; i++) ws.addRow([]);
  return ws;
}
export function faHead(ws: ExcelJS.Worksheet, head: string[]) {
  const h = ws.addRow(head); h.font = { bold: true }; h.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  h.eachCell(c => { c.border = { bottom: { style: 'thin' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFEF' } }; });
  ws.views = [{ state: 'frozen', ySplit: h.number }];
  return h;
}
export function faFormat(ws: ExcelJS.Worksheet, widths: number[], dateCols: number[] = [], numCols: number[] = []) {
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  ws.eachRow(r => { dateCols.forEach(c => { const x = r.getCell(c); if (x.value instanceof Date) x.numFmt = DATE_FMT; }); numCols.forEach(c => { const x = r.getCell(c); if (typeof x.value === 'number') x.numFmt = NUM_FMT; }); });
}

/** ชีต "Accounting Document": ใบสำคัญ JV ที่แตะบัญชีหมวดนั้น (ค่าใช้จ่าย/รายได้) · ใบกลับรายการติดลบและยกเลิก ไม่นับยอด */
export async function acctDocs(db: { q: <T = any>(sql: string, a?: unknown[]) => Promise<T[]> }, kind: 'expense' | 'revenue', range: [string, string] | null) {
  const sign = kind === 'expense' ? 'l.debit - l.credit' : 'l.credit - l.debit';
  return db.q<any>(`select v.voucher_no no, v.voucher_date dt, v.memo, a.code, a.name, sum(${sign}) val,
      case when v.reverses_id is not null or exists (select 1 from journal_vouchers r where r.reverses_id = v.id) then 'cancelled' else 'approved' end status
    from journal_vouchers v join journal_lines l on l.voucher_id = v.id join accounts a on a.id = l.account_id
    where v.voucher_no ~ '^JV' and a.type = $3 and ($1::date is null or v.voucher_date >= $1::date) and ($2::date is null or v.voucher_date <= $2::date)
    group by v.id, a.code, a.name order by v.voucher_date desc, replace(v.voucher_no, '-R', '') desc, v.voucher_no`, [range?.[0] ?? null, range?.[1] ?? null, kind]);
}
export function addAcctSheet(wb: ExcelJS.Workbook, title: string, co: { name: string; tax_id: string }, period: string, rows: any[], blankAfter = 0) {
  const ws = faSheet(wb, 'Accounting Document', title, co, period, 12, blankAfter);
  faHead(ws, ['ลำดับที่', 'เลขที่เอกสาร', 'วัน/เดือน/ปี', 'ผู้ติดต่อ', 'คำอธิบาย', 'เลขที่อ้างอิง', 'ชื่อบัญชี', 'มูลค่า', 'สถานะ', 'ผู้ทำรายการ', 'หมายเหตุ', 'โน้ต (สำหรับใช้ภายในบริษัท)']);
  let tot = 0;
  rows.forEach((r, i) => { ws.addRow([i + 1, r.no, d(r.dt), '', r.memo ?? '', '', `${r.code} / ${r.name}`, Number(r.val), r.status === 'cancelled' ? 'ยกเลิก' : 'อนุมัติ', '', '', '']); if (r.status !== 'cancelled') tot += Number(r.val); });
  const t = ws.addRow([null, null, null, null, null, 'ยอดรวมทั้งหมด', null, tot]); t.font = { bold: true };
  faFormat(ws, [9, 20, 13, 14, 44, 18, 32, 14, 12, 18, 14, 22], [3], [8]);
  return ws;
}
export const companyOf = async (db: { q: <T = any>(sql: string) => Promise<T[]> }) => (await db.q<any>(`select name, tax_id from company_profile`))[0] ?? { name: '', tax_id: '' };
export async function send(wb: ExcelJS.Workbook, name: string) {
  const buf = await wb.xlsx.writeBuffer();
  return new Response(buf as ArrayBuffer, { headers: {
    'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}_${new Date().toISOString().slice(0, 10)}.xlsx` } });
}
