import ExcelJS from 'exceljs';
import { apiUser } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { dateTh, partyName } from '@/lib/format';
import { listFilter, typeOf, type Sp } from '@/lib/sales-list';
import { salesScope } from '@/lib/permissions';
import { DOC_TYPE, STATUS } from '@/lib/status';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /sales/export?type=QT&q=&period=&from=&to=&status=&ids=a,b → Excel ตามเงื่อนไขเดียวกับหน้ารายการ (ทุกหน้า)
export async function GET(req: Request) {
  const au = await apiUser(['sales.read', 'quote.own']); if (au instanceof Response) return au;
  const sp = Object.fromEntries(new URL(req.url).searchParams) as Sp;
  const own = salesScope(au.role) === 'own-quotes';
  const type = typeOf(sp, own);
  if (!type) return Response.json({ error: 'ประเภทเอกสารไม่ถูกต้อง' }, { status: 400 });
  const { where, args, range } = listFilter(sp, type, own, au.id);
  const db = await getDb();
  const rows = await db.q(`select d.id, d.doc_no, d.doc_date, d.status, d.subtotal, d.vat, d.total, d.ref_no, d.project,
      c.business_name, c.contact_name, c.tax_id, c.branch_code, c.branch_name
    from sales_docs d join contacts c on c.id=d.contact_id where ${where} order by d.doc_date, d.doc_no`, args);
  const rel = rows.length ? await db.q(`select ref_doc_id, doc_no from sales_docs where ref_doc_id = any($1::uuid[]) and status<>'cancelled' order by doc_no`, [rows.map((r: any) => r.id)]) : [];
  const co = (await db.q(`select name, tax_id from company_profile`))[0] ?? { name: '', tax_id: '' };
  const name = DOC_TYPE[type];

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(`รายงาน${name}`);
  const head = ['ลำดับที่', 'เลขที่เอกสาร', 'วัน/เดือน/ปี', 'ชื่อลูกค้า', 'ชื่อโปรเจ็ค', 'เลขผู้เสียภาษี', 'สำนักงานใหญ่/สาขา', 'มูลค่า', 'ภาษีมูลค่าเพิ่ม', 'ยอดรวมสุทธิ', 'เอกสารอ้างอิงในระบบ', 'เลขที่อ้างอิง', 'สถานะ'];
  ws.addRow([`รายงาน${name}`]); ws.mergeCells('A1:L1'); ws.getCell('A1').font = { bold: true, size: 14 };
  ws.addRow(['ชื่อบริษัท', co.name]); ws.mergeCells('B2:D2');
  ws.addRow(['เลขผู้เสียภาษี :', co.tax_id]); ws.mergeCells('B3:D3');
  ws.addRow(['ช่วงเวลา :', range ? `${dateTh(range[0])} - ${dateTh(range[1])}` : 'ทั้งหมด']); ws.mergeCells('B4:D4');
  const h = ws.addRow(head); h.font = { bold: true }; h.alignment = { horizontal: 'center' };
  h.eachCell(c => { c.border = { bottom: { style: 'thin' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFEF' } }; });
  const skip = new Set(['cancelled', 'rejected']);
  let sub = 0, vat = 0, tot = 0;
  rows.forEach((r: any, i: number) => {
    const st = STATUS[r.status]?.[0] ?? r.status;
    ws.addRow([i + 1, r.doc_no, dateTh(r.doc_date), partyName(r), r.project ?? '', r.tax_id ?? '',
      r.branch_code ? `สาขา ${r.branch_code}${r.branch_name ? ' ' + r.branch_name : ''}` : 'สำนักงานใหญ่',
      Number(r.subtotal), Number(r.vat), Number(r.total), rel.filter((x: any) => x.ref_doc_id === r.id).map((x: any) => x.doc_no).join(', '), r.ref_no ?? '', st]);
    if (!skip.has(r.status)) { sub += Number(r.subtotal); vat += Number(r.vat); tot += Number(r.total); }
  });
  const first = 6, last = 5 + rows.length;
  const t = ws.addRow(['', '', 'ยอดรวมทั้งหมด']);
  if (rows.length) {
    (['H', 'I', 'J'] as const).forEach((col, k) => {
      t.getCell(col).value = { formula: `SUMIFS(${col}${first}:${col}${last},M${first}:M${last},"<>ไม่อนุมัติ",M${first}:M${last},"<>ยกเลิก")`, result: [sub, vat, tot][k] };
    });
  }
  t.font = { bold: true };
  for (let r = first; r <= last + 1; r++) ['H', 'I', 'J'].forEach(c => { ws.getCell(`${c}${r}`).numFmt = '#,##0.00'; });
  [8, 20, 13, 30, 24, 16, 18, 14, 14, 16, 30, 18, 16].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  ws.views = [{ state: 'frozen', ySplit: 5 }];
  const buf = await wb.xlsx.writeBuffer();
  const fn = `${name}_${new Date().toISOString().slice(0, 10)}.xlsx`;
  return new Response(buf as ArrayBuffer, { headers: {
    'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fn)}`, 'cache-control': 'no-store' } });
}
