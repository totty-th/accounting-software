import ExcelJS from 'exceljs';
import { companyOf, NUM_FMT } from './fa-xlsx';
import { ASSET_STATUS, dmy, num, sum } from './assets';

type Db = { q: <T = any>(sql: string, a?: unknown[]) => Promise<T[]> };
const TH_M = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
export const thLong = (iso: string) => `${Number(iso.slice(8, 10))} ${TH_M[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;

function head(wb: ExcelJS.Workbook, sheet: string, title: string, co: { name: string; tax_id: string }, label: string, value: string, issued: string, cols: number) {
  const ws = wb.addWorksheet(sheet);
  ws.addRow([title]); ws.mergeCells(1, 1, 1, cols); ws.getCell('A1').font = { bold: true, size: 14 };
  ws.addRow(['ชื่อบริษัท', co.name]); ws.mergeCells('B2:D2');
  ws.addRow(['เลขผู้เสียภาษี :', co.tax_id]); ws.mergeCells('B3:D3');
  ws.addRow([label, value]); ws.mergeCells('B4:D4');
  ws.addRow(['วันที่ออกรายงาน :', issued]); ws.mergeCells('B5:D5');
  ws.addRow([]);
  return ws;
}
function headRow(ws: ExcelJS.Worksheet, h: string[]) {
  const r = ws.addRow(h); r.font = { bold: true }; r.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  r.eachCell(c => { c.border = { bottom: { style: 'thin' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFEF' } }; });
  ws.views = [{ state: 'frozen', ySplit: r.number }];
}
function finish(ws: ExcelJS.Worksheet, widths: number[]) {
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  ws.eachRow(r => r.eachCell(c => { if (typeof c.value === 'number' && !Number.isInteger(c.value)) c.numFmt = NUM_FMT; }));
}
const bold = (r: ExcelJS.Row) => { r.font = { bold: true }; return r; };

/** ไฟล์ "รายการสินทรัพย์" (คอลัมน์และการจัดกลุ่มตามต้นแบบ ที่เปิดดูแล้ว 1-11-2026) */
export async function assetListXlsx(db: Db, rows: any[], asof: string, issued: string) {
  const co = await companyOf(db); const wb = new ExcelJS.Workbook();
  const ws = head(wb, 'FixedAssetReport', 'รายการสินทรัพย์', co, 'ณ วันที่ :', thLong(asof), thLong(issued), 19);
  headRow(ws, ['รหัสสินทรัพย์', 'ชื่อสินทรัพย์', 'จำนวน/หน่วย', 'หมวดหมู่สินทรัพย์', 'ที่ตั้งสินทรัพย์', 'ผู้ใช้งาน', 'ชื่อผู้จำหน่าย', 'หมายเลขซีเรียล', 'วันที่ซื้อ', 'วันที่เริ่มต้นใช้งาน',
    'อายุการใช้งาน', 'ระยะเวลาที่ใช้งาน', 'ราคาซื้อ', 'มูลค่าทางบัญชี', 'สถานะ', 'วันที่เลิกใช้', 'มูลค่าที่ขาย (ไม่รวม VAT)', 'กำไร/ขาดทุน', 'หมายเหตุ']);
  const { usedText } = await import('./assets');
  const line = (r: any) => {
    const end = r.disp && r.disp < asof ? r.disp : asof;
    const sold = r.status === 'sold';
    return [r.code, r.name, `${num(r.qty)} ${r.unit ?? ''}`, r.cat_name, r.location ?? '', r.user_name ?? '', r.vendor ?? '', r.serial_no ?? '', dmy(r.purchase), dmy(r.start),
      r.depreciate ? num(r.life_years) : '', usedText(r.start, end < r.start ? r.start : end), num(r.cost), num(r.book), ASSET_STATUS[r.status]?.[0] ?? r.status, dmy(r.disp),
      sold ? num(r.sale_price) : null, sold ? num(r.sale_price) - num(r.book) : null, r.note ?? ''];
  };
  const active = rows.filter(r => !['sold', 'disposed'].includes(r.status)), gone = rows.filter(r => ['sold', 'disposed'].includes(r.status));
  const cats = [...new Set(rows.map(r => r.cat_name))];
  for (const c of cats) {
    const g = rows.filter(r => r.cat_name === c);
    bold(ws.addRow([c]));
    g.forEach(r => ws.addRow(line(r)));
    const t = bold(ws.addRow([`ยอดรวม${c}`, `${g.length} รายการ`])); t.getCell(13).value = sum(g, 'cost'); t.getCell(14).value = sum(g, 'book');
  }
  const ta = bold(ws.addRow(['ยอดรวมสินทรัพย์ที่ยังใช้งานอยู่ทั้งสิ้น', `${active.length} รายการ`])); ta.getCell(13).value = sum(active, 'cost'); ta.getCell(14).value = sum(active, 'book');
  const tg = bold(ws.addRow(['ยอดรวมสินทรัพย์ที่เลิกใช้แล้ว', `${gone.length} รายการ`])); tg.getCell(13).value = sum(gone, 'cost'); tg.getCell(14).value = sum(gone, 'book');
  tg.getCell(17).value = sum(gone.filter(r => r.status === 'sold'), 'sale_price');
  tg.getCell(18).value = Math.round(gone.filter(r => r.status === 'sold').reduce((s, r) => s + num(r.sale_price) - num(r.book), 0) * 100) / 100;
  finish(ws, [16, 34, 12, 26, 16, 14, 22, 16, 13, 14, 10, 14, 14, 14, 14, 13, 16, 14, 20]);
  return wb;
}

/** ไฟล์ "ตารางคำนวณค่าเสื่อมราคา" ของปี */
export async function depXlsx(db: Db, rows: any[], year: number, issued: string) {
  const co = await companyOf(db); const wb = new ExcelJS.Workbook();
  const ws = head(wb, 'DepreciationReport', 'ตารางคำนวณค่าเสื่อมราคา', co, 'ช่วงเวลา :', `1 มกราคม - 31 ธันวาคม ${year}`, thLong(issued), 17);
  headRow(ws, ['รหัสสินทรัพย์', 'ชื่อสินทรัพย์', 'เลขที่อ้างอิง', 'วันที่เริ่มต้นใช้งาน', 'ราคาซื้อ', 'ค่าเสื่อมราคาสะสมยกมา', 'มูลค่าตามบัญชียกมา', 'ค่าเสื่อมต่อปี (%)', 'อายุการใช้งาน (ปี)', 'มูลค่าซาก',
    'มูลค่าที่คำนวณค่าเสื่อม', 'จำนวนวัน', 'ค่าเสื่อมราคาของงวด', 'ค่าเสื่อมราคาสะสมยกไป', 'มูลค่าตามบัญชียกไป', 'สถานะ', 'วันที่เลิกใช้']);
  const tot = (label: string, g: any[]) => {
    const t = bold(ws.addRow([label])); t.getCell(5).value = sum(g, 'cost'); t.getCell(6).value = sum(g, 'accum_in'); t.getCell(7).value = sum(g, 'book_in');
    t.getCell(9).value = g.length; t.getCell(11).value = Math.round(g.reduce((s, r) => s + num(r.cost) - num(r.salvage), 0) * 100) / 100;
    t.getCell(13).value = sum(g, 'dep'); t.getCell(14).value = sum(g, 'accum_out'); t.getCell(15).value = sum(g, 'book_out');
  };
  for (const c of [...new Set(rows.map(r => r.cat_name))]) {
    const g = rows.filter(r => r.cat_name === c);
    bold(ws.addRow([`${c} ${g.length} รายการ`]));
    g.forEach(r => ws.addRow(['', r.name, r.exp_no ?? '', dmy(r.start), num(r.cost), num(r.accum_in), num(r.book_in), `${num(r.rate)}%`, num(r.life_years), num(r.salvage),
      num(r.cost) - num(r.salvage), r.days, num(r.dep), num(r.accum_out), num(r.book_out), ASSET_STATUS[r.status]?.[0] ?? r.status, dmy(r.disp)]));
    tot('ยอดรวม', g);
  }
  tot('ยอดรวมทั้งสิ้น', rows);
  finish(ws, [16, 34, 18, 14, 13, 14, 14, 12, 12, 10, 14, 9, 14, 14, 14, 12, 13]);
  return wb;
}
