// รูปแบบดีไซน์เอกสารขาย (REA FA 02-11-2026)
export interface DocDesign {
  paper: 'a4' | 'continuous'; bw: boolean; font: 'plex' | 'noto' | 'sans'; size: 's' | 'm' | 'l';
  copy_mark: boolean; header_bg: boolean; logo: boolean; stamp: boolean; title: string; show_credit: boolean; show_due: boolean; customer_label: string;
}
export const DEFAULT_DESIGN: DocDesign = { paper: 'a4', bw: false, font: 'plex', size: 'm', copy_mark: true, header_bg: false, logo: true, stamp: true, title: '', show_credit: true, show_due: true, customer_label: '' };
export const FONT_TH = { plex: 'IBM Plex Sans Thai (ค่าเริ่มต้น)', noto: 'Noto Sans Thai', sans: 'ฟอนต์ระบบ (Sarabun/Tahoma)' } as const;
export const FONT_CSS = { plex: "'IBM Plex Sans Thai',system-ui,sans-serif", noto: "'Noto Sans Thai',system-ui,sans-serif", sans: "Sarabun,Tahoma,system-ui,sans-serif" } as const;
export const SIZE_PX = { s: 11.5, m: 13.5, l: 15.5 } as const;
export const DESIGN_TYPES: [string, string][] = [['QT', 'ใบเสนอราคา'], ['INV', 'ใบแจ้งหนี้/ใบกำกับภาษี'], ['CA', 'ใบกำกับภาษี/ใบเสร็จรับเงิน (ขายสด)'], ['BL', 'ใบวางบิล'], ['CN', 'ใบลดหนี้'], ['DN', 'ใบเพิ่มหนี้']];
/** ชื่อหัวเอกสารที่เลือกได้ (FA มีรายการให้เลือก + เพิ่มเองได้) */
export const TITLE_PRESETS: Record<string, string[]> = {
  QT: ['ใบเสนอราคา', 'ใบเสนอราคา/Quotation', 'ใบประเมินราคา', 'ใบสั่งงาน', 'ใบสั่งขาย', 'สัญญาบริการ'],
  INV: ['ใบแจ้งหนี้/ใบกำกับภาษี', 'ใบส่งสินค้า/ใบแจ้งหนี้/ใบกำกับภาษี'], CA: ['ใบกำกับภาษี/ใบเสร็จรับเงิน (ขายสด)'], BL: ['ใบวางบิล', 'ใบแจ้งหนี้'], CN: ['ใบลดหนี้/ใบกำกับภาษี'], DN: ['ใบเพิ่มหนี้/ใบกำกับภาษี'],
};
/** รวมค่า: ค่าเริ่มต้น ← 'all' ← รายชนิด (โหมดขั้นสูง) */
export function resolveDesign(rows: { scope: string; settings: Partial<DocDesign> }[], docType: string): DocDesign {
  const all = rows.find(r => r.scope === 'all')?.settings ?? {}; const one = rows.find(r => r.scope === docType)?.settings ?? {};
  return { ...DEFAULT_DESIGN, ...all, ...one };
}
