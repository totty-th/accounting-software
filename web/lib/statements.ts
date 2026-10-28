// จัดกลุ่มบรรทัดงบการเงินตามกลุ่มบัญชีของ FA (REA 28-10-2026: ผังบัญชี 248 รายการ แบ่งกลุ่ม/หมวดตามช่วงรหัส)
// งบฐานะการเงิน: แสดงระดับ "กลุ่มย่อย" (เช่น เงินสดและรายการเทียบเท่าเงินสด) · งบกำไรขาดทุน: แสดงระดับบัญชี ภายใต้หัวข้อหลัก
// (รหัสบัญชีในระบบเรายังเป็นค่าชั่วคราว จึงไม่ใช้ชื่อกลุ่มย่อยของ FA ตั้งชื่อบรรทัดค่าใช้จ่าย เพื่อไม่ให้ชื่อผิดความหมาย)
export type Line = { code: string; name: string; amount: number; prev?: number };
export type Grp = { name: string; lines: Line[]; amount: number; prev: number };
export type Sec = { name: string; groups: Grp[]; amount: number; prev: number };

const n5 = (c: string) => parseInt(c.slice(0, 5), 10) || 0;
type Rule = [number, number, string, string];   // จากรหัส, ถึงรหัส, หัวข้อ, กลุ่มย่อย
const ASSET: Rule[] = [
  [11100, 11199, 'สินทรัพย์หมุนเวียน', 'เงินสดและรายการเทียบเท่าเงินสด'], [11200, 11299, 'สินทรัพย์หมุนเวียน', 'เงินลงทุนชั่วคราว'],
  [11300, 11399, 'สินทรัพย์หมุนเวียน', 'ลูกหนี้การค้าและลูกหนี้หมุนเวียนอื่น'], [11400, 11499, 'สินทรัพย์หมุนเวียน', 'เงินให้กู้ยืมระยะสั้น'],
  [11500, 11599, 'สินทรัพย์หมุนเวียน', 'สินค้าคงเหลือ'], [11900, 11999, 'สินทรัพย์หมุนเวียน', 'สินทรัพย์หมุนเวียนอื่น'],
  [12200, 12299, 'สินทรัพย์ไม่หมุนเวียน', 'เงินลงทุนระยะยาว'], [12300, 12399, 'สินทรัพย์ไม่หมุนเวียน', 'ลูกหนี้การค้าและลูกหนี้ไม่หมุนเวียนอื่น'],
  [12400, 12499, 'สินทรัพย์ไม่หมุนเวียน', 'เงินให้กู้ยืมระยะยาว'], [12600, 12699, 'สินทรัพย์ไม่หมุนเวียน', 'ที่ดิน อาคาร และอุปกรณ์'],
  [12700, 12799, 'สินทรัพย์ไม่หมุนเวียน', 'สินทรัพย์ไม่มีตัวตน'], [12900, 12999, 'สินทรัพย์ไม่หมุนเวียน', 'สินทรัพย์อื่นๆ'],
  [17100, 17199, 'สินทรัพย์ทางภาษี', 'สินทรัพย์ทางภาษีหมุนเวียน'], [17200, 17299, 'สินทรัพย์ทางภาษี', 'สินทรัพย์ทางภาษีไม่หมุนเวียน'],
  [18000, 18999, 'สินทรัพย์ไม่หมุนเวียน', 'ค่าเสื่อมราคาสะสมและค่าเผื่อด้อยค่า'],
];
const LIAB: Rule[] = [
  [21100, 21199, 'หนี้สินหมุนเวียน', 'เงินเบิกเกินบัญชี/เงินกู้ยืมธนาคารระยะสั้น'], [21300, 21399, 'หนี้สินหมุนเวียน', 'เจ้าหนี้การค้าและเจ้าหนี้หมุนเวียนอื่น'],
  [21400, 21499, 'หนี้สินหมุนเวียน', 'เงินกู้ยืมระยะสั้น'], [21500, 21599, 'หนี้สินหมุนเวียน', 'หนี้สินที่ถึงกำหนดชำระภายใน 1 ปี'],
  [21800, 21899, 'หนี้สินหมุนเวียน', 'ประมาณการหนี้สินระยะสั้น'], [21900, 21999, 'หนี้สินหมุนเวียน', 'หนี้สินหมุนเวียนอื่น'],
  [22300, 22399, 'หนี้สินไม่หมุนเวียน', 'เจ้าหนี้การค้าและเจ้าหนี้ไม่หมุนเวียนอื่น'], [22400, 22499, 'หนี้สินไม่หมุนเวียน', 'เงินกู้ยืมระยะยาว'],
  [22500, 22599, 'หนี้สินไม่หมุนเวียน', 'หนี้สินทางการเงินไม่หมุนเวียนอื่น'], [22800, 22899, 'หนี้สินไม่หมุนเวียน', 'ประมาณการหนี้สินระยะยาว'],
  [27100, 27199, 'หนี้สินทางภาษี', 'หนี้สินทางภาษีหมุนเวียน'], [27200, 27299, 'หนี้สินทางภาษี', 'หนี้สินทางภาษีไม่หมุนเวียน'],
];
export const EQUITY_SEC = 'ส่วนของผู้ถือหุ้น/ส่วนของผู้เป็นหุ้นส่วน';
const EQUITY: Rule[] = [
  [31100, 31199, EQUITY_SEC, 'ทุนจดทะเบียน'], [31000, 31099, EQUITY_SEC, 'ทุนที่ออกและชำระแล้ว'], [31200, 31299, EQUITY_SEC, 'ทุนที่ออกและชำระแล้ว'],
  [32100, 32199, EQUITY_SEC, 'ส่วนเกิน (ต่ำกว่า) มูลค่าหุ้น'], [32000, 32099, EQUITY_SEC, 'กำไร (ขาดทุน) สะสม'], [34000, 34999, EQUITY_SEC, 'กำไร (ขาดทุน) สะสม'],
  [39000, 39999, EQUITY_SEC, 'องค์ประกอบอื่นของส่วนของผู้ถือหุ้น'],
];
export const SEC_ORDER: Record<string, string[]> = {
  asset: ['สินทรัพย์หมุนเวียน', 'สินทรัพย์ไม่หมุนเวียน', 'สินทรัพย์ทางภาษี'],
  liability: ['หนี้สินหมุนเวียน', 'หนี้สินไม่หมุนเวียน', 'หนี้สินทางภาษี'], equity: [EQUITY_SEC],
};
const FALLBACK: Record<string, [string, string]> = { asset: ['สินทรัพย์หมุนเวียน', 'สินทรัพย์หมุนเวียนอื่น'], liability: ['หนี้สินหมุนเวียน', 'หนี้สินหมุนเวียนอื่น'], equity: [EQUITY_SEC, 'องค์ประกอบอื่นของส่วนของผู้ถือหุ้น'] };
export function bsClass(kind: 'asset' | 'liability' | 'equity', code: string): [string, string] {
  const rules = kind === 'asset' ? ASSET : kind === 'liability' ? LIAB : EQUITY, c = n5(code);
  const r = rules.find(x => c >= x[0] && c <= x[1]);
  return r ? [r[2], r[3]] : FALLBACK[kind];
}

const sum = (xs: number[]) => Math.round(xs.reduce((s, x) => s + x, 0) * 100) / 100;
function build(items: { sec: string; grp: string; line: Line }[], order: string[]): Sec[] {
  const secs = new Map<string, Map<string, Line[]>>();
  for (const { sec, grp, line } of items) {
    if (!secs.has(sec)) secs.set(sec, new Map());
    const g = secs.get(sec)!; if (!g.has(grp)) g.set(grp, []); g.get(grp)!.push(line);
  }
  const names = [...order.filter(o => secs.has(o)), ...[...secs.keys()].filter(k => !order.includes(k))];
  return names.map(name => {
    const groups: Grp[] = [...secs.get(name)!.entries()].map(([g, lines]) => ({ name: g, lines: lines.sort((a, b) => a.code.localeCompare(b.code)), amount: sum(lines.map(l => l.amount)), prev: sum(lines.map(l => l.prev ?? 0)) }))
      .sort((a, b) => (a.lines[0].code || '~').localeCompare(b.lines[0].code || '~'));
    return { name, groups, amount: sum(groups.map(g => g.amount)), prev: sum(groups.map(g => g.prev)) };
  });
}

type Row = { section: string; code: string; name: string; amount: number | string };
const merge = (cur: Row[], prev: Row[] | null, zero: Line[]): Map<string, Line & { section: string }> => {
  const m = new Map<string, Line & { section: string }>();
  for (const r of cur) m.set(r.section + '|' + r.code + '|' + r.name, { section: r.section, code: r.code, name: r.name, amount: Number(r.amount), prev: 0 });
  for (const r of prev ?? []) { const k = r.section + '|' + r.code + '|' + r.name; const e = m.get(k); if (e) e.prev = Number(r.amount); else m.set(k, { section: r.section, code: r.code, name: r.name, amount: 0, prev: Number(r.amount) }); }
  void zero; return m;
};

/** งบฐานะการเงิน: rows จาก balance_sheet(asof) (section = asset|liability|equity) · prev = ปีก่อน (ถ้าเปรียบเทียบ) · zeroAccts = บัญชีที่ไม่มียอด (แสดงยอดศูนย์) */
export function buildBalanceSheet(cur: Row[], prev: Row[] | null, zeroAccts: { code: string; name: string; type: string }[] = []) {
  const m = merge(cur, prev, []);
  for (const a of zeroAccts) if (['asset', 'liability', 'equity'].includes(a.type) && ![...m.values()].some(x => x.code === a.code)) m.set(a.type + '|' + a.code, { section: a.type, code: a.code, name: a.name, amount: 0, prev: 0 });
  const block = (kind: 'asset' | 'liability' | 'equity') => {
    const items = [...m.values()].filter(x => x.section === kind).map(x => {
      const isProfit = kind === 'equity' && x.code === '';
      const [sec, grp] = isProfit ? [EQUITY_SEC, 'กำไร (ขาดทุน) สะสม'] : bsClass(kind, x.code);
      return { sec, grp, line: { code: x.code, name: isProfit ? 'กำไร (ขาดทุน) สะสม - รายงาน' : x.name, amount: x.amount, prev: x.prev } };
    });
    const sections = build(items, SEC_ORDER[kind]);
    return { sections, amount: sum(sections.map(s => s.amount)), prev: sum(sections.map(s => s.prev)) };
  };
  return { asset: block('asset'), liability: block('liability'), equity: block('equity') };
}

const PNL_REV: [number, number, string][] = [[41000, 41999, 'รายได้สุทธิ']];
const PNL_EXP: [number, number, string][] = [[51000, 51999, 'ต้นทุนขายสุทธิ'], [52000, 52999, 'ค่าใช้จ่ายในการขาย'], [53000, 53999, 'ค่าใช้จ่ายในการบริหาร'], [54000, 54999, 'ต้นทุนทางการเงิน'],
  [58000, 58999, 'ค่าเสื่อมราคา ด้อยค่า และการตีราคา'], [59000, 59999, 'ค่าใช้จ่ายอื่น']];
export const PNL_REV_ORDER = ['รายได้สุทธิ', 'รายได้อื่น'];
export const PNL_EXP_ORDER = ['ต้นทุนขายสุทธิ', 'ค่าใช้จ่ายในการขาย', 'ค่าใช้จ่ายในการบริหาร', 'ต้นทุนทางการเงิน', 'ค่าเสื่อมราคา ด้อยค่า และการตีราคา', 'ค่าใช้จ่ายอื่น'];
/** งบกำไรขาดทุน: rows จาก income_statement (section = revenue|expense) · แต่ละหัวข้อมีบรรทัดระดับบัญชี (1 กลุ่มย่อยเท่ากับหัวข้อ) */
export function buildPnl(cur: Row[], prev: Row[] | null, zeroAccts: { code: string; name: string; type: string }[] = []) {
  const m = merge(cur, prev, []);
  for (const a of zeroAccts) if (['revenue', 'expense'].includes(a.type) && ![...m.values()].some(x => x.code === a.code)) m.set(a.type + '|' + a.code, { section: a.type, code: a.code, name: a.name, amount: 0, prev: 0 });
  const block = (kind: 'revenue' | 'expense') => {
    const rules = kind === 'revenue' ? PNL_REV : PNL_EXP;
    const items = [...m.values()].filter(x => x.section === kind).map(x => {
      const c = n5(x.code), r = rules.find(z => c >= z[0] && c <= z[1]), sec = r ? r[2] : kind === 'revenue' ? 'รายได้อื่น' : 'ค่าใช้จ่ายอื่น';
      return { sec, grp: sec, line: { code: x.code, name: x.name, amount: x.amount, prev: x.prev } };
    });
    const sections = build(items, kind === 'revenue' ? PNL_REV_ORDER : PNL_EXP_ORDER);
    return { sections, amount: sum(sections.map(s => s.amount)), prev: sum(sections.map(s => s.prev)) };
  };
  const revenue = block('revenue'), expense = block('expense');
  return { revenue, expense, net: sum([revenue.amount, -expense.amount]), netPrev: sum([revenue.prev, -expense.prev]) };
}
