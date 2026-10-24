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

type Ln = DocView['lines'][number];
/** เอกสารแบบเต็มรูปแบบ (ส่วนลด/ภาษี/หัก ณ ที่จ่ายต่อบรรทัด): ใบเสนอราคาทุกใบ และใบแจ้งหนี้ที่สร้างด้วยฟอร์มใหม่ (ทุกบรรทัดมี vat_rate) */
export const isFull = (v: DocView) => v.doc.doc_type === 'QT' || (['INV', 'CA'].includes(v.doc.doc_type) && v.lines.length > 0 && v.lines.every(l => l.vat_rate != null));
export function lineTaxLabel(v: DocView, l?: Ln): string {
  if (v.doc.doc_type === 'BL') return '';
  if (isFull(v) && l) return l.vat_exempt ? 'ยกเว้น' : `${Number(l.vat_rate ?? 7)} %`;
  return c(v.doc.vat) > 0 ? `${Number(v.doc.vat_rate)} %` : 'ไม่มี';
}
export function lineWhtLabel(v: DocView, l?: Ln): string {
  const r = Number(isFull(v) && l ? l.wht_rate ?? 0 : (v.doc as any).wht_rate ?? 0);
  return r > 0 ? `${r} %` : 'ไม่หัก';
}

export function docSummary(v: DocView): { rows: SumRow[]; wht: SumRow[]; total: string } {
  const d = v.doc, t = d.doc_type;
  const sub = c(d.subtotal), vat = c(d.vat), total = c(d.total);
  const rows: SumRow[] = [];
  if (isFull(v)) {   // ใบเสนอราคา/ใบแจ้งหนี้เต็มรูปแบบ: ส่วนลด / ไม่มี-ยกเว้นภาษี / หัก ณ ที่จ่ายต่อบรรทัด
    const disc = c(d.discount_total);
    const noTax = v.lines.reduce((s, l) => s + (l.vat_exempt || Number(l.vat_rate ?? 7) === 0 ? c(l.amount) : 0), 0);
    rows.push({ label: 'รวมเป็นเงิน', value: m(sub + disc) });
    if (disc > 0) rows.push({ label: 'ส่วนลดรวม', value: m(disc) }, { label: 'ราคาหลังหักส่วนลด', value: m(sub) });
    rows.push({ label: 'มูลค่าที่ไม่มี/ยกเว้นภาษี', value: m(noTax), gap: true }, { label: 'มูลค่าที่คำนวณภาษี', value: m(sub - noTax) },
      { label: `ภาษีมูลค่าเพิ่ม ${Number(d.vat_rate)}%`, value: m(vat) }, { label: 'จำนวนเงินรวมทั้งสิ้น', value: m(total), strong: true });
    const w = c(d.wht_total);
    return { rows, wht: [{ label: 'หักภาษี ณ ที่จ่ายทั้งสิ้น', value: m(w) }, { label: 'ยอดจ่าย', value: m(total - w) }], total: m(total) };
  }
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

// ใบส่งของ: บล็อกข้อมูลจัดส่ง (ว่างเมื่อฝ่ายขายยังไม่กรอก)
export function shipRows(v: DocView): [string, string][] {
  const d = v.doc, out: [string, string][] = [];
  if (d.delivery_mode === 'pickup') {
    out.push(['การรับสินค้า', 'ลูกค้ามารับเอง']);
    if (d.ship_name) out.push(['ผู้มารับ', d.ship_name]);
    if (d.ship_phone) out.push(['เบอร์โทร', d.ship_phone]);
  } else if (d.delivery_mode === 'ship') {
    out.push(['ผู้รับ', d.ship_name ?? ''], ['ที่อยู่จัดส่ง', d.ship_address ?? '']);
    if (d.ship_phone) out.push(['เบอร์โทร', d.ship_phone]);
    if (d.carrier) out.push(['ขนส่งโดย', d.carrier]);
  } else return out;
  if (d.delivery_note) out.push(['หมายเหตุจัดส่ง', d.delivery_note]);
  return out;
}
