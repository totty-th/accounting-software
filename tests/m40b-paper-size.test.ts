import { describe, it, expect } from 'vitest';
import { PDFDocument } from '../web/node_modules/pdf-lib';
import { buildDocPdf } from '../web/lib/doc-pdf';
import { buildPrintshopPdf } from '../web/lib/doc-printshop';
import fs from 'node:fs';
import { DEFAULT_DESIGN } from '../web/lib/doc-design';

// กระดาษต่อเนื่องของ FA = 612x792 pt (อ่านจาก PDF ตัวอย่างของ FA) · A4 = 595.28x841.89
const view = (paper: 'a4' | 'continuous'): any => ({
  doc: { id: 'x', doc_type: 'INV', doc_no: 'INV1', doc_date: '2026-11-04', due_date: null, status: 'approved', price_mode: 'exclusive', vat_rate: 7, subtotal: 100, vat: 7, total: 107,
    reason: null, is_deposit: false, deposit_net: 0, deposit_vat: 0 },
  contact: { id: 'c', name: 'ลูกค้า', address: null, tax_id: null, credit_days: 0 }, company: { name: 'บริษัททดสอบ', address: null, tax_id: null },
  design: { ...DEFAULT_DESIGN, paper }, images: { logo: null, stamp: null }, payInfo: [],
  lines: [{ line_no: 1, description: 'สินค้า', item_kind: 'product', qty: 1, unit_price: 100, amount: 100 }], ref: null, children: [], receipts: [], vouchers: [],
});
describe('ขนาดหน้ากระดาษ PDF เอกสารขาย', () => {
  it('A4 = 595x842 · กระดาษต่อเนื่อง = 612x792', async () => {
    for (const [paper, w, h] of [['a4', 595, 842], ['continuous', 612, 792]] as const) {
      const d = await PDFDocument.load(await buildDocPdf(view(paper)));
      const { width, height } = d.getPage(0).getSize();
      expect([Math.round(width), Math.round(height)]).toEqual([w, h]);
    }
  });

  it('แบบโรงพิมพ์: ข้อมูลล้วน 612x792 · แม่แบบเปล่ามี 1 หน้า · เอกสารมัดจำถอยไปรูปแบบมาตรฐาน', async () => {
    const v = view('continuous'); v.design.paper_format = 'printshop';
    v.lines = Array.from({ length: 20 }, (_, i) => ({ line_no: i + 1, description: 'สินค้า ' + (i + 1), item_kind: 'product', qty: 1, unit_price: 100, amount: 100 }));
    const d = await PDFDocument.load(await buildDocPdf(v));
    expect(d.getPageCount()).toBe(2);   // 20 บรรทัด / 16 บรรทัดต่อหน้า
    expect(Math.round(d.getPage(0).getSize().width)).toBe(612);
    const blank = await PDFDocument.load(await buildPrintshopPdf({ docType: 'INV', company: { name: 'บริษัททดสอบ', address: null, tax_id: null }, blank: true }));
    expect(blank.getPageCount()).toBe(1);
    const dep = view('continuous'); dep.design.paper_format = 'printshop'; dep.doc.is_deposit = true;
    expect((await PDFDocument.load(await buildDocPdf(dep))).getPageCount()).toBe(1);
    fs.writeFileSync('/tmp/ps-data.pdf', await buildDocPdf(v)); fs.writeFileSync('/tmp/ps-blank.pdf', await buildPrintshopPdf({ docType: 'INV', company: { name: 'บริษัท ผลิตภัณฑ์ตะแกรงเหล็กแผ่นไทย จำกัด', address: '100/12 ถนนนนทรี แขวงบางโพงพาง เขตยานนาวา กรุงเทพฯ 10120', tax_id: '0105522005334' }, blank: true }));
  });
});
