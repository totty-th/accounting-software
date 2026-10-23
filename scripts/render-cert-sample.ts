// สร้าง PDF ตัวอย่างเพื่อตรวจตำแหน่ง: npx tsx scripts/render-cert-sample.ts out.pdf
import fs from 'node:fs';
import { buildCertPdf, type CertData } from '../web/lib/wht-pdf';
const d: CertData = {
  cert_no: 'WT202610150001', book_no: '1', run_no: '25', seq_in_form: 3, form_choice: '7',
  payer: { name: 'บริษัท ผลิตภัณฑ์ตะแกรงเหล็กแผ่นไทย จำกัด (สำนักงานใหญ่)', address: '100/12 ถนนช่องนนทรี แขวงบางโพงพาง เขตยานนาวา กรุงเทพฯ 10120', tax_id: '0105522005334', person_kind: 'juristic' },
  payee: { name: 'บริษัท ผู้ขายทดสอบ จำกัด (สำนักงานใหญ่)', address: '1 ถนนทดสอบ แขวงสีลม เขตบางรัก กรุงเทพฯ 10500', tax_id: '0105500000001', person_kind: 'juristic' },
  income_category: '5', income_note: null, pay_date: '2026-10-22', base_amount: 10000, wht_amount: 300,
  payer_condition: 'withhold', payer_condition_note: null, fund_gpf: 0, fund_sso: 0, fund_pvd: 0, issue_date: '2026-10-22', missing: [],
};
buildCertPdf(d).then(b => fs.writeFileSync(process.argv[2] ?? 'cert.pdf', b));
