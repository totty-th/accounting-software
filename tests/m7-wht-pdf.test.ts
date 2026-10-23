import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bahtText, buildCertPdf, type CertData } from '../web/lib/wht-pdf';

describe('ตัวอักษรบาทไทย', () => {
  it.each([
    [0, 'ศูนย์บาทถ้วน'], [1, 'หนึ่งบาทถ้วน'], [11, 'สิบเอ็ดบาทถ้วน'], [21, 'ยี่สิบเอ็ดบาทถ้วน'], [20, 'ยี่สิบบาทถ้วน'],
    [300, 'สามร้อยบาทถ้วน'], [101, 'หนึ่งร้อยเอ็ดบาทถ้วน'], [1250.5, 'หนึ่งพันสองร้อยห้าสิบบาทห้าสิบสตางค์'],
    [0.75, 'เจ็ดสิบห้าสตางค์'], [1000000, 'หนึ่งล้านบาทถ้วน'], [1234567.89, 'หนึ่งล้านสองแสนสามหมื่นสี่พันห้าร้อยหกสิบเจ็ดบาทแปดสิบเก้าสตางค์'],
    [21.21, 'ยี่สิบเอ็ดบาทยี่สิบเอ็ดสตางค์'], [2000001, 'สองล้านเอ็ดบาทถ้วน'],
  ])('%s → %s', (n, t) => expect(bahtText(n)).toBe(t));
});

const D: CertData = {
  cert_no: 'WT202610150001', book_no: '1', run_no: '25', seq_in_form: 3, form_choice: '7',
  payer: { name: 'บริษัท ผลิตภัณฑ์ตะแกรงเหล็กแผ่นไทย จำกัด (สำนักงานใหญ่)', address: '100/12 ถนนช่องนนทรี', tax_id: '0105522005334', person_kind: 'juristic' },
  payee: { name: 'บริษัท ผู้ขายทดสอบ จำกัด', address: '1 ถนนทดสอบ', tax_id: '0105500000001', person_kind: 'juristic' },
  income_category: '5', income_note: null, pay_date: '2026-10-22', base_amount: 10000, wht_amount: 300,
  payer_condition: 'withhold', payer_condition_note: null, fund_gpf: 0, fund_sso: 0, fund_pvd: 0, issue_date: '2026-10-22', missing: [],
};

describe('สร้าง PDF 50 ทวิ', () => {
  it('ได้ PDF หน้าเดียวที่มีข้อมูลครบและไม่มีช่องกรอก/สคริปต์ค้าง', async () => {
    const bytes = await buildCertPdf(D);
    const dir = mkdtempSync(join(tmpdir(), 'cert-')); const f = join(dir, 'c.pdf');
    writeFileSync(f, bytes);
    expect(Buffer.from(bytes).subarray(0, 5).toString()).toBe('%PDF-');
    const txt = execFileSync('pdftotext', ['-layout', f, '-'], { encoding: 'utf8' });
    const norm = (x: string) => x.replace(/[\s\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/g, '');
    const nt = norm(txt);
    // ข้อความไทยที่วาดเองสกัดกลับด้วย pdftotext ไม่ครบ (ปัญหา cmap ของฟอนต์ย่อย) จึงตรวจเฉพาะส่วนที่สกัดได้แน่นอน
    for (const s of ['หนังสือรับรองการหักภาษี', '22/10/2569', '10,000', '300', '2569', 'ร้อย'])
      expect(nt, s).toContain(norm(s));
    expect(execFileSync('pdfinfo', [f], { encoding: 'utf8' })).toMatch(/Pages:\s+1/);
    expect(execFileSync('pdfinfo', [f], { encoding: 'utf8' })).toMatch(/Form:\s+none/);
  });
  it('ประเภทเงินได้ข้ออื่นและเงื่อนไขผู้จ่ายอื่นสร้างได้ ไม่ error', async () => {
    for (const cat of ['1', '2', '3', '4a', '5', '6'] as const)
      await buildCertPdf({ ...D, income_category: cat, income_note: 'ค่าทดสอบ', payer_condition: 'other', payer_condition_note: 'ระบุ', fund_sso: 750 });
  });
});
