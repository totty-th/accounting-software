// บัญชีแยกประเภทแบบ FA (REA 1-11-2026): ตัวกรองวันที่ · หมวดบัญชี · ดาวน์โหลด · ยอดเป็นด้านปกติของบัญชี (สินทรัพย์/ค่าใช้จ่าย = เดบิต−เครดิต · อื่น ๆ = เครดิต−เดบิต)
import ExcelJS from 'exceljs';
import { monthRange, yearRange } from './closing';
import { faHead, xDate, NUM_FMT, DATE_FMT } from './fa-xlsx';

type Db = { q: <T = any>(sql: string, a?: unknown[]) => Promise<T[]> };
const pad = (n: number) => String(n).padStart(2, '0');
const isDate = (s?: string) => /^\d{4}-\d{2}-\d{2}$/.test(s ?? '');
const addMonths = (y: number, m: number, d: number) => { const t = y * 12 + (m - 1) + d; return [Math.floor(t / 12), (t % 12) + 1] as const; };
const MTH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
export const thDate = (d: string) => `${d.slice(8)} ${MTH[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
export const dmy = (d: string) => `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}`;

export const GL_PRESETS: [string, string][] = [['cur', 'เดือนนี้'], ['prev', 'เดือนที่แล้ว'], ['3m', '3 เดือนล่าสุด'], ['12m', '12 เดือนล่าสุด'], ['ycur', 'ปีนี้'], ['yprev', 'ปีที่แล้ว']];
export type GlRange = { m: string; from: string; to: string; label: string };
/** ช่วงวันที่ของหน้าบัญชีแยกประเภท · m = ทางลัด (cur/prev/3m/12m/ycur/yprev) | month (month=YYYY-MM) | year (year=YYYY ปีงบ) | range (from,to) · ค่าเริ่มต้น = ปีงบปีปัจจุบัน */
export function glRange(q: { m?: string; month?: string; year?: string; from?: string; to?: string }, today: string): GlRange {
  const ty = Number(today.slice(0, 4)), tm = Number(today.slice(5, 7));
  const mk = (m: string, r: { from: string; to: string }, label: string): GlRange => ({ m, ...r, label });
  switch (q.m) {
    case 'all': return mk('all', { from: '1900-01-01', to: '2999-12-31' }, 'ทั้งหมด');
    case 'cur': return mk('cur', monthRange(ty, tm), 'เดือนนี้');
    case 'prev': { const [y, m] = addMonths(ty, tm, -1); return mk('prev', monthRange(y, m), 'เดือนที่แล้ว'); }
    case '3m': { const [y, m] = addMonths(ty, tm, -2); return mk('3m', { from: `${y}-${pad(m)}-01`, to: monthRange(ty, tm).to }, '3 เดือนล่าสุด'); }
    case '12m': { const [y, m] = addMonths(ty, tm, -11); return mk('12m', { from: `${y}-${pad(m)}-01`, to: monthRange(ty, tm).to }, '12 เดือนล่าสุด'); }
    case 'ycur': return mk('ycur', yearRange(ty), 'ปีนี้');
    case 'yprev': return mk('yprev', yearRange(ty - 1), 'ปีที่แล้ว');
    case 'month': if (/^\d{4}-\d{2}$/.test(q.month ?? '') && Number(q.month!.slice(5)) >= 1 && Number(q.month!.slice(5)) <= 12) { const y = Number(q.month!.slice(0, 4)), m = Number(q.month!.slice(5)); return mk('month', monthRange(y, m), `${MTH[m - 1]} ${y}`); } break;
    case 'year': if (/^\d{4}$/.test(q.year ?? '')) return mk('year', yearRange(Number(q.year)), `ปี ${q.year}`); break;
    case 'range': if (isDate(q.from) && isDate(q.to) && q.from! <= q.to!) return mk('range', { from: q.from!, to: q.to! }, `${thDate(q.from!)} – ${thDate(q.to!)}`); break;
  }
  return mk('fy', yearRange(ty), `ปีงบ ${ty}`);
}
/** พารามิเตอร์ URL ของช่วงวันที่ (ไม่ใส่เมื่อเป็นค่าเริ่มต้น) */
export const rangeParams = (r: GlRange): Record<string, string> =>
  r.m === 'fy' ? {} : r.m === 'all' ? { m: 'all' } : r.m === 'month' ? { m: 'month', month: r.from.slice(0, 7) } : r.m === 'year' ? { m: 'year', year: r.from.slice(0, 4) } : r.m === 'range' ? { m: 'range', from: r.from, to: r.to } : { m: r.m };

export const GL_TYPES: [string, string][] = [['asset', 'สินทรัพย์'], ['liability', 'หนี้สิน'], ['equity', 'ส่วนของผู้ถือหุ้น'], ['revenue', 'รายได้'], ['expense', 'ค่าใช้จ่าย']];
export const typeTh = (t: string) => GL_TYPES.find(x => x[0] === t)?.[1] ?? t;
export const debitNature = (t: string) => t === 'asset' || t === 'expense';
/** ยอดตามด้านปกติของบัญชี (dr−cr สำหรับสินทรัพย์/ค่าใช้จ่าย · cr−dr สำหรับอื่น ๆ) */
export const natural = (t: string, net: number) => (debitNature(t) ? net : 0 - net) + 0;
export const parseTypes = (s?: string) => (s ?? '').split(',').filter(t => GL_TYPES.some(x => x[0] === t));
/** แสดงยอดแบบ FA: ศูนย์ = "-" · ติดลบ = (วงเล็บ) */
export const faMoney = (n: unknown) => { const v = Number(n ?? 0); if (!v) return '-'; const s = Math.abs(v).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); return v < 0 ? `(${s})` : s; };
export const JOURNAL_TH: Record<string, string> = { SV: 'รายวันขาย', UV: 'รายวันซื้อ', RV: 'รายวันรับ', PV: 'รายวันจ่าย', JV: 'รายวันทั่วไป', CP: 'รายวันทั่วไป' };

export type ListRow = { id: string; code: string; name: string; type: string; description: string | null; is_active: boolean; bal: number; n: number; g2: string; g3: string };
/** รายการบัญชีย่อย (ไม่รวมบัญชีคุม) + ยอดคงเหลือ "เดบิต−เครดิต" ในช่วง (แบบ FA: เครดิตสุทธิเป็นวงเล็บ) · บัญชีงบแสดงฐานะ = ยอดสะสมถึงสิ้นช่วง · รายได้/ค่าใช้จ่าย = ยอดเคลื่อนไหวในช่วง · g2/g3 = ชื่อกลุ่มบัญชีระดับ 2 และ 3 ในต้นไม้ */
export async function glList(db: Db, o: { q: string; types: string[]; from: string; to: string; all: boolean; desc: boolean }): Promise<ListRow[]> {
  const rows = await db.q<any>(
    `select a.id, a.code, a.name, a.type, a.description, a.is_active,
            coalesce(sum(case when a.type in ('revenue','expense') then (case when v.voucher_date between $1::date and $2::date then l.debit - l.credit end)
                              else (case when v.voucher_date <= $2::date then l.debit - l.credit end) end), 0) net,
            count(case when v.voucher_date between $1::date and $2::date then 1 end)::int n,
            coalesce(g.g2, '') g2, coalesce(g.g3, '') g3
       from accounts a left join journal_lines l on l.account_id = a.id left join journal_vouchers v on v.id = l.voucher_id
       left join lateral (
         with recursive up(id, parent_id, name, d) as (select a.id, a.parent_id, a.name, 0 union all select p.id, p.parent_id, p.name, up.d + 1 from up join accounts p on p.id = up.parent_id)
         select (select name from up where parent_id is not null and d = (select max(d) from up) - 1) g2,
                (select name from up where parent_id is not null and d = (select max(d) from up) - 2) g3) g on true
      where not a.is_control
        and (cardinality($3::text[]) = 0 or a.type = any($3::text[]))
        and ($4 = '' or a.code ilike '%'||$4||'%' or a.name ilike '%'||$4||'%' or coalesce(a.description, '') ilike '%'||$4||'%' or coalesce(g.g2, '') ilike '%'||$4||'%' or coalesce(g.g3, '') ilike '%'||$4||'%')
        and ($5 or a.is_active)
      group by a.id, g.g2, g.g3 order by a.code ${o.desc ? 'desc' : 'asc'}`, [o.from, o.to, o.types, o.q, o.all]);
  return rows.map(r => ({ ...r, bal: Number(r.net) + 0, n: Number(r.n) }));
}

export type LedgerLine = { d: string; no: string; vt: string; memo: string; ref: string; contact: string; by: string; debit: number; credit: number; cancelled: boolean; k: number; bal: number };
export type Ledger = { code: string; name: string; type: string; opening: number; lines: LedgerLine[]; closing: number };
/** บัญชีแยกประเภทของบัญชีที่เลือก · ยอดยกมา: บัญชีงบแสดงฐานะ = ยอดสะสมก่อนวันเริ่ม · รายได้/ค่าใช้จ่าย = ยอดตั้งแต่ต้นปีของวันเริ่มถึงก่อนวันเริ่ม · รายการที่ยกเลิก (ใบกลับรายการ -R และใบเดิม) ซ่อนไว้ ยกเว้นสั่งแสดง */
export async function glLedgers(db: Db, codes: string[], from: string, to: string, withCancelled: boolean, search = ''): Promise<Ledger[]> {
  if (!codes.length) return [];
  const accs = await db.q<any>('select id, code, name, type from accounts where code = any($1::text[]) order by code', [codes]);
  const ids = accs.map(a => a.id);
  const open = await db.q<any>(
    `select l.account_id id, sum(l.debit - l.credit) net from journal_lines l join journal_vouchers v on v.id = l.voucher_id join accounts a on a.id = l.account_id
      where l.account_id = any($1::uuid[]) and v.voucher_date < $2::date and (a.type not in ('revenue','expense') or v.voucher_date >= make_date(extract(year from $2::date)::int, 1, 1)) group by l.account_id`, [ids, from]);
  const src = await db.q<any>(
    `select l.account_id id, v.voucher_date d, v.voucher_no no, v.voucher_type vt, coalesce(l.description, v.memo, '') memo, coalesce(v.ref_no, '') ref,
            coalesce(c.business_name, c.contact_name, '') contact, coalesce(u.display_name, '') by, l.debit, l.credit,
            (v.reverses_id is not null or exists (select 1 from journal_vouchers r where r.reverses_id = v.id)) cancelled
       from journal_lines l join journal_vouchers v on v.id = l.voucher_id left join contacts c on c.id = v.contact_id left join app_users u on u.id = v.created_by
      where l.account_id = any($1::uuid[]) and v.voucher_date between $2::date and $3::date
      order by v.voucher_date, v.created_at, v.voucher_no, l.line_no`, [ids, from, to]);
  const s = search.trim().toLowerCase();
  return accs.map(a => {
    const o = natural(a.type, Number(open.find(x => x.id === a.id)?.net ?? 0));
    let bal = o;
    const out: LedgerLine[] = [];
    for (const r of src.filter(x => x.id === a.id)) {
      const dr = Number(r.debit), cr = Number(r.credit), k = natural(a.type, dr - cr);
      bal += k;  // คู่ใบเดิม/ใบกลับรายการหักล้างกันเอง จึงซ่อนได้โดยยอดสะสมไม่เพี้ยน
      if (r.cancelled && !withCancelled) continue;
      const line: LedgerLine = { d: String(r.d instanceof Date ? r.d.toISOString() : r.d).slice(0, 10), no: r.no, vt: r.vt, memo: r.memo, ref: r.ref, contact: r.contact, by: r.by, debit: dr, credit: cr, cancelled: !!r.cancelled, k, bal };
      if (s && ![line.no, line.memo, line.ref, line.contact].some(x => String(x).toLowerCase().includes(s))) continue;
      out.push(line);
    }
    return { code: a.code, name: a.name, type: a.type, opening: o, lines: out, closing: bal };
  });
}

/** ไฟล์ Excel "บัญชีแยกประเภท" (ตามไฟล์ FA: หัวรายงาน + ยอดยกมา + รายการ + ยอดคงเหลือ ต่อบัญชี) · หลายบัญชี = เฉพาะบัญชีที่มีรายการในช่วง */
export async function glWorkbook(db: Db, o: { company: string; user: string; today: string; codes: string[]; from: string; to: string; explicit: boolean; withCancelled?: boolean; allDates?: boolean }) {
  let ledgers = await glLedgers(db, o.codes, o.from, o.to, !!o.withCancelled);
  if (!(o.explicit && o.codes.length === 1)) ledgers = ledgers.filter(l => l.lines.length > 0);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Book Of Account');
  ws.addRow([null, null, 'บัญชีแยกประเภท']); ws.mergeCells('C1:K1'); ws.getCell('C1').font = { bold: true, size: 14 }; ws.getCell('C1').alignment = { horizontal: 'center' };
  const info = (r: number, a: string, b: string, l?: string, m?: string) => {
    const row = ws.getRow(r); row.getCell(1).value = a; row.getCell(1).font = { bold: true }; row.getCell(2).value = b;
    if (l) { row.getCell(12).value = l; row.getCell(12).font = { bold: true }; row.getCell(13).value = m; ws.mergeCells(r, 13, r, 14); }
    ws.mergeCells(r, 2, r, 11);
  };
  const codesTxt = ledgers.length === 0 ? '-' : ledgers.length === 1 ? ledgers[0].code : `${ledgers[0].code} ถึง ${ledgers[ledgers.length - 1].code}`;
  info(2, 'ชื่อบริษัท :', o.company); info(3, 'ช่วงเวลา :', o.allDates ? 'ทั้งหมด' : `${dmy(o.from)} ถึง ${dmy(o.to)}`, 'วันที่นำข้อมูลออก', dmy(o.today)); info(4, 'รหัสบัญชี :', codesTxt, 'นำข้อมูลออกโดย', o.user);
  ws.addRow([]);
  const h = faHead(ws, ['รหัสบัญชี', 'วันที่', 'สมุดรายวัน', 'เลขที่เอกสาร', 'ชื่อบัญชี', 'เลขที่อ้างอิง', 'ผู้ติดต่อ', 'รายละเอียด/คำอธิบายรายการ', 'เดบิต', 'เครดิต', 'จำนวน', 'ยอดคงเหลือ', 'สถานะ', 'ผู้ทำรายการ']);
  h.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF23AEE7' } }; });
  const band = (r: ExcelJS.Row) => { r.font = { bold: true }; r.eachCell({ includeEmpty: true }, (c, i) => { if (i <= 14) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3FBFE' } }; }); };
  for (const l of ledgers) {
    if (!['revenue', 'expense'].includes(l.type)) { const r = ws.addRow([l.code, null, null, null, l.name, null, null, 'ยอดยกมา', 0, null, 0, l.opening]); band(r); r.getCell(9).value = l.opening > 0 && debitNature(l.type) ? l.opening : 0; r.getCell(11).value = l.opening; }
    else band(ws.addRow([l.code, null, null, null, l.name]));   // รายได้/ค่าใช้จ่าย: แถวหัวบัญชีไม่แสดงยอดยกมา (ยอดสะสมก่อนช่วงยังนับในยอดคงเหลือ)
    for (const x of l.lines) {
      ws.addRow([l.code, xDate(x.d), JOURNAL_TH[x.vt] ?? x.vt, x.no, l.name, x.ref, x.contact || ' ', x.memo, x.debit || ' ', x.credit || ' ', x.k, x.bal, x.cancelled ? 'ยกเลิก' : null, x.by]);
    }
    const t = ws.addRow([l.code, null, null, null, l.name, null, null, 'ยอดคงเหลือ', null, null, l.closing, l.closing < 0 ? (debitNature(l.type) ? 'Cr.' : 'Dr.') : (debitNature(l.type) ? 'Dr.' : 'Cr.')]); band(t);
  }
  [10, 12, 14, 20, 30, 20, 30, 45, 13, 13, 15, 15, 10, 27].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  ws.eachRow(r => { const d = r.getCell(2); if (d.value instanceof Date) d.numFmt = DATE_FMT; for (const c of [9, 10, 11, 12]) { const x = r.getCell(c); if (typeof x.value === 'number') x.numFmt = '_(* #,##0.00_);_(* (#,##0.00);_(* " - "??_);_(@_)'; } });
  void NUM_FMT;
  return { wb, first: ledgers[0]?.code ?? '', last: ledgers[ledgers.length - 1]?.code ?? '' };
}

const CAT_EN: Record<string, string> = { asset: 'Assets', liability: 'Liabilities', equity: 'Equity', revenue: 'Revenue', expense: 'Expenses' };
/** ไฟล์ "โครงสร้างผังบัญชี" (แบบ FA): ทุกบัญชีทั้งบัญชีคุมและบัญชีย่อย · Code / ชื่อบัญชี / Account Name / ประเภท / Category / ประเภทบัญชี / Account Type */
export async function chartWorkbook(db: Db, o: { company: string; user: string; now: string }) {
  const rows = await db.q<any>('select code, name, name_en, type, is_control from accounts order by code');
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Chart of Accounts');
  ws.addRow([o.company]); ws.addRow(['ผังบัญชี / Chart of Account']); ws.addRow([`วันที่ส่งออก / Export Date: ${o.now}`]); ws.addRow([`ส่งออกโดย / Exported by: ${o.user}`]);
  ws.getCell('A1').font = { bold: true }; ws.getCell('A2').font = { bold: true, size: 14 };
  faHead(ws, ['Code', 'ชื่อบัญชี', 'Account Name', 'ประเภท', 'Category', 'ประเภทบัญชี', 'Account Type']);
  for (const r of rows) ws.addRow([r.code, r.name, r.name_en ?? '', typeTh(r.type), CAT_EN[r.type], r.is_control ? 'บัญชีคุม' : 'บัญชีย่อย', r.is_control ? 'Control Account' : 'Sub-Account']);
  [14, 44, 36, 20, 14, 16, 18].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  return wb;
}
