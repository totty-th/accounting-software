import type { DocView } from './doc-view';

// ค่าที่ต้องแสดงในส่วนสรุปยอดและลายเซ็นของเอกสาร A4 (ใช้ร่วมกันระหว่างหน้าจอและ PDF)
// คำนวณเป็นสตางค์ (จำนวนเต็ม) เพื่อไม่ให้เศษทศนิยมเพี้ยน เป็นค่าแสดงผลเท่านั้น ไม่มีผลต่อรายการบัญชี
const c = (x: unknown) => Math.round(Number(x ?? 0) * 100);
const m = (cents: number) => (cents / 100).toFixed(2);

export interface SumRow { label: string; value: string; strong?: boolean; gap?: boolean }

export const SIGNERS: Record<string, [string, string]> = {
  QT: ['ผู้สั่งซื้อสินค้า', 'ผู้อนุมัติ'],
  INV: ['ผู้รับสินค้า / บริการ', 'ผู้อนุมัติ'],
  CA: ['ผู้รับสินค้า / บริการ', 'ผู้อนุมัติ'],
  BL: ['ผู้รับวางบิล', 'ผู้วางบิล'],
  CN: ['ผู้รับสินค้า / บริการ', 'ผู้อนุมัติ'],
  DN: ['ผู้รับสินค้า / บริการ', 'ผู้อนุมัติ'],
  RE: ['ผู้จ่ายเงิน', 'ผู้รับเงิน'],
};

export function lineTaxLabel(v: DocView): string {
  if (v.doc.doc_type === 'BL') return '';
  return c(v.doc.vat) > 0 ? `${Number(v.doc.vat_rate)} %` : 'ไม่มี';
}
export function lineWhtLabel(v: DocView): string {
  const r = Number((v.doc as any).wht_rate ?? 0);
  return r > 0 ? `${r} %` : 'ไม่หัก';
}

export function docSummary(v: DocView): { rows: SumRow[]; wht: SumRow[]; total: string } {
  const d = v.doc, t = d.doc_type;
  const sub = c(d.subtotal), vat = c(d.vat), total = c(d.total);
  const rows: SumRow[] = [];
  if (t === 'CN' || t === 'DN') {
    const orig = c(v.ref?.subtotal), diff = sub;
    rows.push({ label: 'มูลค่าตามเอกสารเดิม', value: m(orig) },
      { label: 'มูลค่าที่ถูกต้อง', value: m(t === 'CN' ? orig - diff : orig + diff) },
      { label: 'ผลต่าง', value: m(diff), gap: true });
  }
  rows.push({ label: 'รวมเป็นเงิน', value: m(sub) });
  if (t !== 'BL') {
    const taxed = vat > 0;
    rows.push({ label: 'มูลค่าที่ไม่มี/ยกเว้นภาษี', value: m(taxed ? 0 : sub), gap: true },
      { label: 'มูลค่าที่คำนวณภาษี', value: m(taxed ? sub : 0) },
      { label: `ภาษีมูลค่าเพิ่ม ${Number(d.vat_rate)}%`, value: m(vat) });
  }
  if (c(d.deposit_net) > 0) rows.push({ label: 'หักมัดจำ (ก่อนภาษี)', value: m(c(d.deposit_net)) });
  rows.push({ label: 'จำนวนเงินรวมทั้งสิ้น', value: m(total), strong: true });
  const wht: SumRow[] = [];
  if (t !== 'BL') {
    const w = Math.round(sub * Number((d as any).wht_rate ?? 0) / 100);
    wht.push({ label: 'หักภาษี ณ ที่จ่ายทั้งสิ้น', value: m(w) }, { label: 'ยอดจ่าย', value: m(total - w) });
  }
  return { rows, wht, total: m(total) };
}
