// นำเข้าสินค้าจากไฟล์ (ตามขั้นตอน FA: อัปโหลด → จับคู่คอลัมน์ → รายละเอียด → ตรวจสอบ) · ฟังก์ชันล้วน ไม่แตะฐานข้อมูล
export const MAX_ROWS = 500;
export const MAX_UNITS = 10;

export const FIELDS = [
  ['kind', 'ประเภทสินค้า', true], ['name', 'ชื่อสินค้า', true], ['unit', 'หน่วยสินค้าหลัก', true],
  ['code', 'รหัสสินค้า (SKU)', false], ['category', 'หมวดสินค้า', false], ['barcode', 'เลขบาร์โค้ด', false], ['description', 'รายละเอียดสินค้า', false],
  ['sale', 'ราคาขาย', false], ['sale_vat', 'ภาษีมูลค่าเพิ่ม (ขาย)', false], ['buy', 'ราคาซื้อ', false], ['buy_vat', 'ภาษีมูลค่าเพิ่ม (ซื้อ)', false], ['goods_type', 'ประเภท (สินค้าเพื่อขาย/อื่น ๆ)', false],
  ['u_unit', 'หน่วยสินค้าอื่น', false], ['u_factor', 'อัตราแปลง (1 หน่วยอื่น = กี่หน่วยหลัก)', false], ['u_sale', 'ราคาขาย (หน่วยอื่น)', false], ['u_buy', 'ราคาซื้อ (หน่วยอื่น)', false], ['u_barcode', 'บาร์โค้ด (หน่วยอื่น)', false],
  ['o_qty', 'จำนวนยอดตั้งต้น', false], ['o_cost', 'ต้นทุนต่อหน่วย (ยอดตั้งต้น)', false], ['o_date', 'วันที่ตั้งต้น', false],
] as const;
export type FieldKey = (typeof FIELDS)[number][0];

// คำที่ใช้จับคู่หัวคอลัมน์อัตโนมัติ (ตัดช่องว่าง/ตัวพิมพ์เล็ก)
const SYN: Record<FieldKey, string[]> = {
  kind: ['ประเภทสินค้า', 'ชนิดสินค้า', 'producttype', 'type'], name: ['ชื่อสินค้า', 'ชื่อ', 'name', 'productname'], unit: ['หน่วยสินค้าหลัก', 'หน่วยหลัก', 'หน่วย', 'unit', 'mainunit'],
  code: ['รหัสสินค้า', 'รหัส', 'sku', 'code', 'productcode'], category: ['หมวดสินค้า', 'หมวด', 'category'], barcode: ['เลขบาร์โค้ด', 'บาร์โค้ด', 'barcode'],
  description: ['รายละเอียดสินค้า', 'รายละเอียด', 'description'], sale: ['ราคาขาย', 'saleprice', 'sellingprice'], sale_vat: ['ภาษีมูลค่าเพิ่มขาย', 'vatขาย', 'ภาษีขาย', 'salevat'],
  buy: ['ราคาซื้อ', 'purchaseprice', 'buyprice'], buy_vat: ['ภาษีมูลค่าเพิ่มซื้อ', 'vatซื้อ', 'ภาษีซื้อ', 'purchasevat'], goods_type: ['ประเภท', 'ประเภทสินค้าไม่นับสต็อก'],
  u_unit: ['หน่วยสินค้าอื่น', 'หน่วยอื่น', 'otherunit'], u_factor: ['อัตราแปลง', 'จำนวนต่อหน่วย', 'factor', 'conversion'], u_sale: ['ราคาขายหน่วยอื่น'], u_buy: ['ราคาซื้อหน่วยอื่น'], u_barcode: ['บาร์โค้ดหน่วยอื่น'],
  o_qty: ['จำนวนยอดตั้งต้น', 'ยอดตั้งต้น', 'จำนวนตั้งต้น', 'openingqty'], o_cost: ['ต้นทุนต่อหน่วย', 'ต้นทุน', 'openingcost'], o_date: ['วันที่ตั้งต้น', 'วันที่ยอดตั้งต้น', 'openingdate'],
};
const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[\s_\-()*:./]/g, '');

/** จับคู่หัวคอลัมน์ของไฟล์กับฟิลด์ของระบบ (คืน index ของคอลัมน์ หรือ -1) */
export function autoMap(headers: string[]): Record<FieldKey, number> {
  const out = {} as Record<FieldKey, number>; const used = new Set<number>();
  const hs = headers.map(norm);
  for (const [k] of FIELDS) {
    let idx = hs.findIndex((h, i) => !used.has(i) && SYN[k].some(s => norm(s) === h));
    if (idx < 0) idx = hs.findIndex((h, i) => !used.has(i) && h && SYN[k].some(s => norm(s).length > 3 && h.startsWith(norm(s))));
    out[k] = idx; if (idx >= 0) used.add(idx);
  }
  return out;
}

export type ImportItem = {
  kind: 'service' | 'goods_nostock' | 'goods_stock'; code: string; name: string; unit: string; category: string; barcode: string; description: string;
  sale: number; buy: number; sale_vat: string; buy_vat: string; goods_type: string;
  units: { unit: string; factor: number; sale: number; buy: number; barcode: string }[]; open: { qty: number; cost: number; date: string } | null;
};
export type RowIssue = { row: number; message: string };   // row = เลขแถวในไฟล์ (ไม่นับหัวตาราง เริ่ม 1)
export type Validation = { items: ImportItem[]; issues: RowIssue[]; ready: number; total: number };

const KIND: Record<string, ImportItem['kind']> = {
  'บริการ': 'service', 'service': 'service', 'สินค้าไม่นับสต็อก': 'goods_nostock', 'ไม่นับสต็อก': 'goods_nostock', 'nonstock': 'goods_nostock',
  'สินค้านับสต็อก': 'goods_stock', 'นับสต็อก': 'goods_stock', 'stock': 'goods_stock', 'inventory': 'goods_stock',
};
const VAT: Record<string, string> = {
  'ราคายังไม่รวมvat': 'exclusive', 'ราคายังไม่รวมภาษี': 'exclusive', 'exclusive': 'exclusive', 'ไม่รวมvat': 'exclusive',
  'ราคารวมvatแล้ว': 'inclusive', 'รวมvat': 'inclusive', 'inclusive': 'inclusive', 'vat0%': 'zero', 'vat0': 'zero', 'zero': 'zero',
  'สินค้าได้รับยกเว้นภาษี(n/a)': 'exempt', 'สินค้าได้รับยกเว้นภาษี': 'exempt', 'ยกเว้นภาษี': 'exempt', 'exempt': 'exempt', 'n/a': 'exempt',
};
const GT: Record<string, string> = { 'สินค้าเพื่อขาย': 'for_sale', 'forsale': 'for_sale', 'อื่นๆ': 'other', 'other': 'other' };

const num = (v: unknown): number | null => { const s = String(v ?? '').replace(/,/g, '').trim(); if (s === '') return null; const n = Number(s); return Number.isFinite(n) ? n : NaN; };
/** วันที่ได้ทั้ง yyyy-mm-dd, dd/mm/yyyy (พ.ศ. หรือ ค.ศ.) และ Date จาก Excel */
export function parseDateCell(v: unknown): string | null {
  if (v instanceof Date && !isNaN(+v)) return v.toISOString().slice(0, 10);
  const s = String(v ?? '').trim(); if (!s) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return fmt(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/.exec(s);
  if (m) return fmt(+m[3] > 2400 ? +m[3] - 543 : +m[3], +m[2], +m[1]);
  return null;
}
function fmt(y: number, mo: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, mo - 1, d)); if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** ตรวจไฟล์ทั้งชุดตามกฎของ FA · existingCodes = รหัสที่มีในระบบแล้ว · ผิดแถวเดียวก็นำเข้าไม่ได้ (ready < total) */
export function validateImport(rows: unknown[][], map: Record<FieldKey, number>, existingCodes: Set<string>, opts: { vat: boolean } = { vat: true }): Validation {
  const issues: RowIssue[] = []; const bad = (row: number, message: string) => issues.push({ row, message });
  const cell = (r: unknown[], k: FieldKey) => (map[k] >= 0 ? r[map[k]] : undefined);
  const str = (r: unknown[], k: FieldKey) => String(cell(r, k) ?? '').trim();
  if (rows.length === 0) return { items: [], issues: [{ row: 0, message: 'ไม่พบข้อมูลในไฟล์' }], ready: 0, total: 0 };
  if (rows.length > MAX_ROWS) return { items: [], issues: [{ row: 0, message: `ไฟล์มี ${rows.length} แถว เกินกำหนด ${MAX_ROWS} แถวต่อไฟล์` }], ready: 0, total: rows.length };
  const lower = new Set([...existingCodes].map(c => c.toLowerCase()));
  const groups = new Map<string, { first: number; item: ImportItem; names: Set<string>; rowsOf: number[] }>();
  const badRows = new Set<number>(); let seq = 0;
  rows.forEach((r, i) => {
    const row = i + 1; const before = issues.length;
    const kindRaw = norm(str(r, 'kind')), kind = KIND[str(r, 'kind').replace(/\s/g, '')] ?? KIND[kindRaw];
    if (!kind) bad(row, str(r, 'kind') ? `ประเภทสินค้า "${str(r, 'kind')}" ไม่ถูกต้อง (บริการ / สินค้าไม่นับสต็อก / สินค้านับสต็อก)` : 'ต้องระบุประเภทสินค้า');
    const name = str(r, 'name'); if (!name) bad(row, 'ต้องระบุชื่อสินค้า');
    const unit = str(r, 'unit');
    if (kind && kind !== 'service' && !unit) bad(row, 'ต้องระบุหน่วยสินค้าหลัก');
    const code = str(r, 'code');
    if (code && lower.has(code.toLowerCase())) bad(row, `รหัสสินค้า "${code}" ซ้ำกับสินค้าที่มีอยู่แล้วในระบบ`);
    const sale = num(cell(r, 'sale')), buy = num(cell(r, 'buy'));
    if (Number.isNaN(sale) || (sale ?? 0) < 0) bad(row, 'ราคาขายต้องเป็นตัวเลขไม่ติดลบ');
    if (Number.isNaN(buy) || (buy ?? 0) < 0) bad(row, 'ราคาซื้อต้องเป็นตัวเลขไม่ติดลบ');
    const vv = (k: FieldKey, label: string) => { const raw = str(r, k); if (!raw) return 'exclusive'; const v = VAT[norm(raw)]; if (!v) { bad(row, `${label} "${raw}" ไม่ถูกต้อง`); return 'exclusive'; }
      if (!opts.vat && v !== 'exclusive') bad(row, `${label}: กิจการที่ไม่ได้จดทะเบียน VAT เลือกได้เฉพาะ "ราคายังไม่รวม VAT"`); return v; };
    const sale_vat = vv('sale_vat', 'ภาษีมูลค่าเพิ่ม (ขาย)'), buy_vat = vv('buy_vat', 'ภาษีมูลค่าเพิ่ม (ซื้อ)');
    const gtRaw = str(r, 'goods_type'); const goods_type = gtRaw ? GT[norm(gtRaw)] ?? '' : 'for_sale';
    if (!goods_type) bad(row, `ประเภท "${gtRaw}" ไม่ถูกต้อง (สินค้าเพื่อขาย / อื่น ๆ)`);
    // ฟิลด์ที่ไม่ตรงกับประเภทสินค้า
    if (kind === 'service' && (buy || str(r, 'buy_vat') || str(r, 'o_qty') || str(r, 'u_unit'))) bad(row, 'บริการระบุได้เฉพาะข้อมูลฝั่งขาย (ไม่มีราคาซื้อ/ยอดตั้งต้น/หน่วยอื่น)');
    if (kind === 'goods_nostock' && (str(r, 'o_qty') || str(r, 'o_cost') || str(r, 'u_unit'))) bad(row, 'สินค้าไม่นับสต็อกไม่มียอดตั้งต้น/ต้นทุน/หน่วยสินค้าอื่น');
    // หน่วยอื่น
    let u: ImportItem['units'][number] | null = null;
    if (str(r, 'u_unit')) {
      const f = num(cell(r, 'u_factor'));
      if (f == null || Number.isNaN(f) || f <= 0) bad(row, 'หน่วยสินค้าอื่นต้องระบุอัตราแปลงมากกว่า 0');
      else u = { unit: str(r, 'u_unit'), factor: f, sale: num(cell(r, 'u_sale')) || 0, buy: num(cell(r, 'u_buy')) || 0, barcode: str(r, 'u_barcode') };
      if (u && u.unit === unit) bad(row, 'หน่วยสินค้าอื่นต้องไม่ซ้ำกับหน่วยหลัก');
    }
    // ยอดตั้งต้น
    let open: ImportItem['open'] = null;
    const oq = num(cell(r, 'o_qty')), oc = num(cell(r, 'o_cost')), od = parseDateCell(cell(r, 'o_date'));
    if (oq != null || oc != null || str(r, 'o_date')) {
      if (kind === 'goods_stock') {
        if (oq == null || Number.isNaN(oq) || oq <= 0) bad(row, 'จำนวนยอดตั้งต้นต้องมากกว่า 0');
        else if (oc == null || Number.isNaN(oc) || oc < 0) bad(row, 'ยอดตั้งต้นต้องระบุต้นทุนต่อหน่วย');
        else if (!od) bad(row, 'ยอดตั้งต้นต้องระบุวันที่ที่ถูกต้อง (วว/ดด/ปปปป หรือ ปปปป-ดด-วว)');
        else open = { qty: oq, cost: oc, date: od };
      }
    }
    const key = code ? `c:${code.toLowerCase()}` : `r:${++seq}`;
    const item: ImportItem = { kind: kind ?? 'service', code, name, unit: kind === 'service' ? unit : unit, category: str(r, 'category'), barcode: str(r, 'barcode'), description: str(r, 'description'),
      sale: sale || 0, buy: buy || 0, sale_vat, buy_vat, goods_type: goods_type || 'for_sale', units: u ? [u] : [], open };
    const g = groups.get(key);
    if (!g) groups.set(key, { first: row, item, names: new Set([name]), rowsOf: [row] });
    else {
      // แถวต่อ ๆ ไปของ SKU เดียวกัน = หน่วยสินค้าอื่น: ข้อมูลหลักต้องตรงกัน
      g.rowsOf.push(row);
      const a = g.item;
      if (a.kind !== item.kind || a.name !== item.name || a.unit !== item.unit || a.sale !== item.sale || a.buy !== item.buy) bad(row, `ข้อมูลหลักของ SKU "${code}" ไม่ตรงกับแถว ${g.first} (ชื่อ/ประเภท/หน่วยหลัก/ราคา)`);
      if (open) { if (!a.open) bad(row, 'ยอดตั้งต้นต้องระบุที่แถวแรกของสินค้านั้นเท่านั้น'); else if (a.open.qty !== open.qty || a.open.cost !== open.cost || a.open.date !== open.date) bad(row, 'ยอดตั้งต้นของ SKU เดียวกันต้องตรงกันทุกแถว'); }
      if (item.units[0]) { if (a.units.some(x => x.unit === item.units[0].unit)) bad(row, `หน่วยสินค้าอื่น "${item.units[0].unit}" ซ้ำใน SKU เดียวกัน`); else a.units.push(item.units[0]); }
    }
    if (issues.length > before) badRows.add(row);
  });
  for (const g of groups.values()) {
    if (g.item.units.length > MAX_UNITS) bad(g.first, `หน่วยสินค้าอื่นเกิน ${MAX_UNITS} หน่วยต่อสินค้า`);
    if (g.item.units.length && g.item.kind !== 'goods_stock') bad(g.first, 'หน่วยสินค้าอื่นใช้ได้เฉพาะสินค้านับสต็อก');
  }
  issues.sort((a, b) => a.row - b.row);
  const items = [...groups.values()].map(g => g.item);
  const badSet = new Set(issues.map(i => i.row));
  return { items, issues, ready: rows.length - badSet.size, total: rows.length };
}

/** เติมรหัสสินค้าอัตโนมัติให้รายการที่ไม่มี SKU (ใช้ตอนนำเข้า) */
export function fillCodes(items: ImportItem[], taken: Set<string>): ImportItem[] {
  const t = new Set([...taken].map(c => c.toLowerCase())); let n = 0;
  return items.map(it => { if (it.code) return it; let c: string; do { c = `AUTO-${String(++n).padStart(4, '0')}`; } while (t.has(c.toLowerCase())); t.add(c.toLowerCase()); return { ...it, code: c }; });
}
