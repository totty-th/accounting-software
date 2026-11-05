import { describe, it, expect } from 'vitest';
import { PDFDocument } from '../web/node_modules/pdf-lib';
import { buildDocPdf } from '../web/lib/doc-pdf';
import { DEFAULT_DESIGN } from '../web/lib/doc-design';
import fs from 'node:fs';
const IM = fs.existsSync('/tmp/claude-0/imgs.json') ? JSON.parse(fs.readFileSync('/tmp/claude-0/imgs.json', 'utf8')) : { logo: null, stamp: null, sig: null };

const view = (n = 2): any => ({
  doc: { id: 'x', doc_type: 'QT', doc_no: 'TMP-QT2026-00050', doc_date: '2026-11-05', due_date: null, status: 'pending_approval', price_mode: 'exclusive', vat_rate: 7, subtotal: 13680.8, vat: 957.66, total: 14638.46,
    reason: null, is_deposit: false, deposit_net: 0, deposit_vat: 0, discount_total: 279.2, salesperson: 'จิม', credit_days: 30, term_mode: 'credit' },
  contact: { id: 'c', name: 'บริษัท ชัยวัฒนา สามเอ จำกัด (สำนักงานใหญ่)', address: '4 ซ.จันทน์18/1 แขวงทุ่งวัดดอน เขตสาทร กทม. 10120', tax_id: '0105555000226', credit_days: 30, person: '-', phone: '035-274965-6 T.085-649-5905(K.ผกา)' },
  company: { name: 'บริษัท ผลิตภัณฑ์ตะแกรงเหล็กแผ่นไทย จำกัด', name_en: 'Thai Metal Perforation Co., Ltd.', address: '100/12 ถนนนนทรี แขวงบางโพงพาง เขตยานนาวา กรุงเทพฯ 10120', tax_id: '0105522005334', phone: '02-266-8315-9', email: 'sales@thaiperforate.com', signer_name: 'คุณาภร ปัญญาเวช' },
  design: { ...DEFAULT_DESIGN, layout: 'branded', form_code: 'FM-SA-01-01 Rev.01' }, images: { logo: IM.logo, stamp: IM.stamp, signature: IM.sig }, payInfo: [],
  lines: Array.from({ length: n }, (_, i) => ({ line_no: i + 1, description: 'ตะแกรงเหล็กหนา 5mm 3P', item_kind: 'product', qty: 1, unit: 'แผ่น', unit_price: 2000, discount: 40, discount_type: 'percent', discount_value: 2, amount: 1960, vat_rate: 7 })),
  ref: null, children: [], receipts: [], vouchers: [],
});
describe('เอกสารรูปแบบแบรนด์', () => {
  it('สร้าง A4 ได้ · หลายบรรทัดขึ้นหน้าใหม่ · มีรหัสแบบฟอร์ม', async () => {
    const one = await PDFDocument.load(await buildDocPdf(view(2)));
    expect(one.getPageCount()).toBe(1); expect(Math.round(one.getPage(0).getSize().width)).toBe(595);
    const many = await PDFDocument.load(await buildDocPdf(view(40)));
    expect(many.getPageCount()).toBeGreaterThan(1);
    fs.writeFileSync('/tmp/claude-0/branded.pdf', await buildDocPdf(view(2)));
    const std = view(2); std.design.layout = 'standard'; std.doc.doc_type = 'INV';
    fs.writeFileSync('/tmp/claude-0/standard.pdf', await buildDocPdf(std));
  });
});
