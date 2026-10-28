import ExcelJS from 'exceljs';
import { Readable } from 'node:stream';
import { apiUser } from '@/lib/auth';
import { MAX_ROWS } from '@/lib/product-import';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const MAX_BYTES = 4 * 1024 * 1024;     // ข้อจำกัดของโฮสต์ (FA = 5 MB)

const cellVal = (v: ExcelJS.CellValue): unknown => {
  if (v == null) return '';
  if (v instanceof Date) return v;
  if (typeof v === 'object') { const o = v as any; if ('result' in o) return cellVal(o.result); if ('richText' in o) return o.richText.map((t: any) => t.text).join(''); if ('text' in o) return o.text; return String(v); }
  return v;
};

// POST /products/import/parse (multipart: file) → { headers, rows } · รองรับ .xlsx / .csv
export async function POST(req: Request) {
  const au = await apiUser('master.write'); if (au instanceof Response) return au;
  const f = (await req.formData()).get('file');
  if (!(f instanceof File)) return Response.json({ error: 'ไม่พบไฟล์' }, { status: 400 });
  const name = f.name.toLowerCase();
  if (!/\.(xlsx|csv)$/.test(name)) return Response.json({ error: 'รองรับเฉพาะไฟล์ .xlsx และ .csv (ไฟล์ .xls เก่าให้บันทึกเป็น .xlsx ก่อน)' }, { status: 400 });
  if (f.size > MAX_BYTES) return Response.json({ error: 'ไฟล์ใหญ่เกิน 4 MB' }, { status: 400 });
  const buf = Buffer.from(await f.arrayBuffer());
  const wb = new ExcelJS.Workbook();
  try {
    if (name.endsWith('.csv')) { const txt = buf.toString('utf8').replace(/^﻿/, ''); await wb.csv.read(Readable.from([txt]), { parserOptions: { delimiter: ',' } }); }
    else await wb.xlsx.load(buf as any);
  } catch { return Response.json({ error: 'อ่านไฟล์ไม่ได้ — ตรวจสอบว่าเป็นไฟล์ Excel/CSV ที่ถูกต้อง' }, { status: 400 }); }
  const ws = wb.worksheets[0]; if (!ws) return Response.json({ error: 'ไม่พบข้อมูลในไฟล์' }, { status: 400 });
  const all: unknown[][] = []; ws.eachRow({ includeEmpty: false }, row => { const a: unknown[] = []; for (let c = 1; c <= ws.columnCount; c++) a.push(cellVal(row.getCell(c).value)); all.push(a); });
  const rows = all.filter(r => r.some(x => String(x ?? '').trim() !== ''));
  if (rows.length < 1) return Response.json({ error: 'ไม่พบข้อมูลในไฟล์' }, { status: 400 });
  const headers = rows[0].map(x => String(x ?? '').trim());
  const data = rows.slice(1);
  return Response.json({ file: f.name, headers, rows: data.slice(0, MAX_ROWS + 1).map(r => r.map(x => (x instanceof Date ? x.toISOString().slice(0, 10) : x))), total: data.length });
}
