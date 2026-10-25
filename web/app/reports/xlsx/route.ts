import ExcelJS from 'exceljs';
import { apiUser } from '@/lib/auth';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Body = { title: string; meta?: [string, string][]; head: string[]; rows: { cells: string[]; bold?: boolean; sub?: boolean }[] };
const NUM = /^-?[\d,]+\.\d{2}$/;
// POST /reports/xlsx — รับตารางที่แสดงอยู่บนหน้ารายงาน (หัวตาราง + แถว) แล้วสร้างไฟล์ Excel (ตัวเลขเป็นตัวเลขจริง)
export async function POST(req: Request) {
  const au = await apiUser(['reports.read']); if (au instanceof Response) return au;
  const b = await req.json() as Body;
  if (!b?.title || !Array.isArray(b.head) || !Array.isArray(b.rows) || b.rows.length > 20000) return Response.json({ error: 'ข้อมูลรายงานไม่ถูกต้อง' }, { status: 400 });
  const co = (await (await getDb()).q<any>(`select name, tax_id from company_profile`))[0] ?? { name: '', tax_id: '' };
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(b.title.slice(0, 30).replace(/[\\/?*[\]:]/g, ' '));
  const w = Math.max(b.head.length, 2);
  ws.addRow([b.title]); ws.mergeCells(1, 1, 1, w); ws.getCell('A1').font = { bold: true, size: 14 };
  ws.addRow(['ชื่อบริษัท', co.name]); ws.addRow(['เลขผู้เสียภาษี :', co.tax_id]);
  for (const [k, v] of b.meta ?? []) ws.addRow([k, v]);
  const hr = ws.addRow(b.head); hr.font = { bold: true }; hr.alignment = { horizontal: 'center' };
  hr.eachCell(c => { c.border = { bottom: { style: 'thin' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFEF' } }; });
  const width = b.head.map(h => Math.max(10, h.length + 4));
  for (const r of b.rows) {
    const row = ws.addRow(r.cells.map(c => NUM.test(c.trim()) ? Number(c.replace(/,/g, '')) : c));
    row.eachCell(c => { if (typeof c.value === 'number') c.numFmt = '#,##0.00'; });
    if (r.bold) row.font = { bold: true };
    if (r.sub) row.font = { color: { argb: 'FF666666' }, italic: true };
    r.cells.forEach((c, i) => { width[i] = Math.min(46, Math.max(width[i] ?? 10, c.length + 2)); });
  }
  width.forEach((x, i) => { ws.getColumn(i + 1).width = x; });
  ws.views = [{ state: 'frozen', ySplit: hr.number }];
  const buf = await wb.xlsx.writeBuffer();
  return new Response(buf as ArrayBuffer, { headers: {
    'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(b.title)}_${new Date().toISOString().slice(0, 10)}.xlsx` } });
}
