// ค้นหาสินค้าแบบหลายคำ + คุณสมบัติจากชื่อสินค้า (M63 · ใช้ทั้งฝั่งหน้าจอและเซิร์ฟเวอร์ ห้าม import ของฝั่งเซิร์ฟเวอร์)
// - พิมพ์หลายคำ ลำดับใดก็ได้ ต้องเจอครบทุกคำ เช่น "304 กลม หนา 1.5 รู 5" เจอ "ตะแกรงแสตนเลสรูกลม SS304 หนา 1.5 มม. รู 5 มม."
// - ตัวเลขเทียบเป็นค่า: "1" = "1.0" แต่ไม่ตรงกับ "1.5" หรือ "12" · ไม่สนเครื่องหมาย ' (4x8 = 4'x8') · สะกด สแตนเลส/แสตนเลส ได้ทั้งคู่

const SYN: [RegExp, string][] = [[/ส[แเ]ตน[เล]ล?ส|แสตนเลส|สเตนเลส|stainless/g, 'แสตนเลส'], [/อลูมิเนียม|อะลูมิเนียม|aluminium|aluminum/g, 'อลูมิเนียม'], [/[×*]/g, 'x']];

/** ทำข้อความให้อยู่ในรูปเดียวกัน: ตัวเล็ก · ตัด ' " · คำพ้อง · ตัวเลขตัดศูนย์ท้ายทศนิยม (1.0 → 1, 1.50 → 1.5) */
export function norm(s: string): string {
  let t = (s ?? '').toLowerCase().replace(/['"’”`]/g, '');
  for (const [r, v] of SYN) t = t.replace(r, v);
  t = t.replace(/(\d+)\.(\d*?)0+(?!\d)/g, (_, a, b) => (b ? `${a}.${b}` : a));
  return t.replace(/\s+/g, ' ').trim();
}
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** แปลงคำค้นเป็นตัวทดสอบต่อคำ (สร้างครั้งเดียว ใช้กับหลายสินค้า) */
export function matcher(q: string): (hay: string) => boolean {
  const raw = norm(q).replace(/(หนา|รู|เบอร์)(\d)/g, '$1 $2').split(' ').filter(Boolean);
  if (!raw.length) return () => true;
  const isNum = (t: string) => /^\d+(\.\d+)?$/.test(t);
  const re = (src: string) => { const r = new RegExp(src); return (h: string) => r.test(h); };
  const tests: ((h: string) => boolean)[] = [];
  for (let i = 0; i < raw.length; i++) {
    const t = raw[i], nx = raw[i + 1];
    // "หนา 1.5" / "รู 5" / "เบอร์ 10" = คู่กัน (ไม่ใช่เจอ 1.5 ที่ไหนก็ได้)
    if (['หนา', 'รู', 'เบอร์', 'p'].includes(t) && nx && isNum(nx)) { tests.push(re(`${esc(t)}\\s*${esc(nx)}(?!\\d|\\.\\d)`)); i++; continue; }
    tests.push(isNum(t) ? re(`(?<![\\d.])${esc(t)}(?!\\d|\\.\\d)`) : (h: string) => h.includes(t));
  }
  return (hay: string) => tests.every(f => f(hay));
}
export const hayOf = (p: { code?: string | null; name: string; category?: string | null; barcode?: string | null }) =>
  norm(`${p.code ?? ''} ${p.name} ${p.category ?? ''} ${p.barcode ?? ''}`);

export type Attrs = { material: string; hole: string; thick: string; sheet: string };
export const ATTR_LABEL: Record<keyof Attrs, string> = { material: 'วัสดุ', hole: 'ชนิดรู', thick: 'ความหนา (มม.)', sheet: 'ขนาดแผ่น' };

/** แยกคุณสมบัติจากชื่อสินค้า (ชื่อสินค้าตะแกรงเขียนรูปแบบเดียวกันอยู่แล้ว) · หาไม่เจอ = '' */
export function attrsOf(name: string): Attrs {
  const n = norm(name);
  const material = /อลูมิเนียม/.test(n) ? 'อลูมิเนียม' : /ss ?316/.test(n) ? 'SS316' : /ss ?(เกรด )?430/.test(n) ? 'SS430'
    : /ss ?304/.test(n) ? 'SS304' : /แสตนเลส|\bss\b/.test(n) ? 'แสตนเลส' : /เหล็ก/.test(n) ? 'เหล็ก' : '';
  const hole = /ฉีก|x[sg]-?\d/.test(n) ? 'ฉีก' : /รูกลม/.test(n) ? 'รูกลม' : /รูยาว/.test(n) ? 'รูยาว' : /หกเหลี่ยม/.test(n) ? 'รูหกเหลี่ยม'
    : /สามเหลี่ยม/.test(n) ? 'รูสามเหลี่ยม' : /สี่เหลี่ยม/.test(n) ? 'รูสี่เหลี่ยม' : /ยืด|\bct\b/.test(n) ? 'ยืด' : '';
  const thick = n.match(/หนา\s*([\d.]+)/)?.[1] ?? '';
  const s = n.match(/(\d+)\s*x\s*(\d+)(?=\s|$)/);
  const sheet = s && Number(s[1]) <= 10 && Number(s[2]) <= 20 ? `${s[1]}'x${s[2]}'` : '';
  return { material, hole, thick, sheet };
}
const numSort = (a: string, b: string) => (Number(a) - Number(b)) || a.localeCompare(b, 'th');
/** ค่าที่มีในชุดสินค้า (สำหรับตัวกรอง) พร้อมจำนวน */
export function facets<T extends { name: string }>(rows: T[]): Record<keyof Attrs, [string, number][]> {
  const out = { material: new Map<string, number>(), hole: new Map<string, number>(), thick: new Map<string, number>(), sheet: new Map<string, number>() };
  for (const r of rows) { const a = attrsOf(r.name); (Object.keys(out) as (keyof Attrs)[]).forEach(k => { if (a[k]) out[k].set(a[k], (out[k].get(a[k]) ?? 0) + 1); }); }
  const srt = (m: Map<string, number>, num = false) => [...m.entries()].sort((a, b) => (num ? numSort(a[0], b[0]) : b[1] - a[1]));
  return { material: srt(out.material), hole: srt(out.hole), thick: srt(out.thick, true), sheet: srt(out.sheet) };
}
/** ผ่านตัวกรองคุณสมบัติที่เลือกไว้หรือไม่ (ค่าว่าง = ไม่กรอง) */
export const attrOk = (name: string, f: Partial<Attrs>) => {
  const keys = (Object.keys(f) as (keyof Attrs)[]).filter(k => f[k]);
  if (!keys.length) return true;
  const a = attrsOf(name);
  return keys.every(k => a[k] === f[k]);
};
