// แปลงข้อความ CSV รายการเดินบัญชีเป็นแถวสำหรับ bank_statement_import
// หัวคอลัมน์ที่รู้จัก: วันที่ / รายละเอียด / ถอน(เงินออก) / ฝาก(เงินเข้า) / คงเหลือ (ลำดับไหนก็ได้)
export type StmtRow = { date: string; description: string; deposit: number; withdrawal: number; balance: number | null };

function splitCsv(line: string): string[] {
  const out: string[] = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map(s => s.trim());
}
const num = (s: string | undefined) => {
  const t = (s ?? '').replace(/[,\s]/g, '');
  if (t === '' || t === '-') return 0;
  const n = Number(t);
  if (!Number.isFinite(n)) throw new Error(`ตัวเลขไม่ถูกต้อง: ${s}`);
  return n;
};
// รองรับ YYYY-MM-DD และ DD/MM/YYYY (ปี พ.ศ. > 2400 แปลงเป็น ค.ศ.)
export function parseDate(s: string): string {
  const t = s.trim().split(/[ T]/)[0];
  let y: number, m: number, d: number, g: RegExpMatchArray | null;
  if ((g = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) { y = +g[1]; m = +g[2]; d = +g[3]; }
  else if ((g = t.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/))) { d = +g[1]; m = +g[2]; y = +g[3]; }
  else throw new Error(`วันที่ไม่ถูกต้อง: ${s}`);
  if (y > 2400) y -= 543;
  const iso = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  if (isNaN(Date.parse(iso)) || new Date(iso).getUTCDate() !== d) throw new Error(`วันที่ไม่ถูกต้อง: ${s}`);
  return iso;
}

export function parseStatementCsv(text: string): StmtRow[] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim() !== '');
  if (lines.length < 2) throw new Error('ไฟล์ไม่มีข้อมูล');
  const head = splitCsv(lines[0]);
  const find = (...names: string[]) => head.findIndex(h => names.some(n => h.includes(n)));
  const ix = { date: find('วันที่', 'date'), desc: find('รายละเอียด', 'description'),
    w: find('ถอน', 'เงินออก', 'withdraw'), d: find('ฝาก', 'เงินเข้า', 'deposit'), b: find('คงเหลือ', 'balance') };
  if (ix.date < 0 || ix.w < 0 || ix.d < 0) throw new Error('ไม่พบคอลัมน์ วันที่ / ถอน / ฝาก ในบรรทัดแรก');
  return lines.slice(1).map((l, i) => {
    const c = splitCsv(l);
    try {
      return { date: parseDate(c[ix.date]), description: ix.desc >= 0 ? c[ix.desc] : '',
        deposit: num(c[ix.d]), withdrawal: num(c[ix.w]), balance: ix.b >= 0 && c[ix.b] ? num(c[ix.b]) : null };
    } catch (e: any) { throw new Error(`แถวที่ ${i + 1}: ${e.message}`); }
  });
}
