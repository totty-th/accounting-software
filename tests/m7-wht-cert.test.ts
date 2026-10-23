import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';

const dir = new URL('../supabase/migrations/', import.meta.url);
let db: PGlite;
let vendor: string;
const D = '2026-10-15';
const ACCOUNTS: [string, string, string][] = [
  ['11112', 'เงินสด', 'asset'], ['17113', 'ภาษีซื้อยังไม่ถึงกำหนด', 'asset'],
  ['21399', 'เจ้าหนี้อื่นๆ', 'liability'], ['27124', 'ภาษีหัก ณ ที่จ่าย ภ.ง.ด.53', 'liability'], ['27123', 'ภาษีหัก ณ ที่จ่าย ภ.ง.ด.3 (ทดสอบ)', 'liability'],
  ['53101', 'ค่าบริการ', 'expense'], ['53102', 'ค่าเช่า', 'expense'],
];
const err = async (p: Promise<unknown>) => { try { await p; return ''; } catch (e) { return (e as Error).message; } };
const one = async <T = any>(q: string, a: unknown[] = []) => (await db.query<any>(q, a)).rows[0] as T;
const line = (account: string, price: number, extra: object = {}) =>
  ({ description: 'รายการ', account, qty: 1, unit_price: price, ...extra });
const payWithCert = async (lines: object[], form = 'PND53') => {
  const id = (await one<{ id: string }>('select create_expense($1::date,$2,$3::jsonb) as id', [D, vendor, JSON.stringify(lines)])).id;
  await db.query('select pay_expense($1,$2::date,$3,$4,$5)', [id, D, '11112', true, form]);
  return (await one<{ id: string }>('select id from wht_certs where expense_id=$1', [id])).id;
};
const data = async (id: string) => (await one<{ d: any }>('select wht_cert_data($1) as d', [id])).d;
const PROFILE = `insert into company_profile(name,address,tax_id) values
  ('บริษัท ผลิตภัณฑ์ตะแกรงเหล็กแผ่นไทย จำกัด (สำนักงานใหญ่)','100/12 ถนนช่องนนทรี แขวงบางโพงพาง เขตยานนาวา กรุงเทพฯ 10120','0105522005334')`;

beforeAll(async () => {
  db = new PGlite();
  for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(new URL(f, dir), 'utf8'));
  await db.exec(`update wht_forms set account_code='27123' where code='PND3'`);
});
beforeEach(async () => {
  await db.exec(`truncate company_profile, wht_certs, expense_lines, expenses, receipt_items, receipts, billing_note_items,
                 sales_doc_lines, sales_docs, contacts, journal_lines, journal_vouchers, period_locks, doc_sequences, accounts cascade`);
  for (const [c, n, t] of ACCOUNTS) await db.query('insert into accounts(code,name,type) values ($1,$2,$3)', [c, n, t]);
  vendor = (await one<{ id: string }>(`insert into contacts(business_name, tax_id, address, person_kind)
    values ('ผู้ขายทดสอบ','0105500000001','1 ถนนทดสอบ กรุงเทพฯ 10110','juristic') returning id`)).id;
});

describe('M7 ข้อมูลบริษัทและผู้ถูกหัก', () => {
  it('ข้อมูลบริษัทมีได้แถวเดียว และเลขผู้เสียภาษีต้อง 13 หลัก', async () => {
    await db.exec(PROFILE);
    expect(await err(db.exec(PROFILE))).toContain('company_profile');
    await db.exec('truncate company_profile');
    expect(await err(db.query(`insert into company_profile(name,address,tax_id) values ('a','b','123')`))).toContain('check');
  });
  it('ประเภทบุคคลของผู้ติดต่อรับเฉพาะ individual/juristic', async () => {
    expect(await err(db.query(`update contacts set person_kind='x' where id=$1`, [vendor]))).toContain('check');
  });
});

describe('M7 ข้อมูลใบหนังสือรับรอง', () => {
  it('ฐานภาษีเป็นยอดก่อน VAT เฉพาะรายการที่ถูกหัก และข้อมูลครบตามแบบ', async () => {
    await db.exec(PROFILE);
    const id = await payWithCert([line('53101', 10000, { wht_rate: 3 }), line('53102', 6000)]);
    const d = await data(id);
    expect([+d.base_amount, +d.wht_amount]).toEqual([10000, 300]);
    expect(d.form_choice).toBe('7');
    expect(d.payer.tax_id).toBe('0105522005334');
    expect(d.payee).toMatchObject({ name: 'ผู้ขายทดสอบ', tax_id: '0105500000001', person_kind: 'juristic' });
    expect(d.income_category).toBe('5');
    expect(d.payer_condition).toBe('withhold');
    expect(d.pay_date).toBe(D);
    expect(d.missing).toEqual([]);
  });
  it('ภ.ง.ด.3 เลือกช่องที่ 4 ของแบบ', async () => {
    await db.exec(PROFILE);
    const id = await payWithCert([line('53101', 10000, { wht_rate: 3 })], 'PND3');
    expect((await data(id)).form_choice).toBe('4');
  });
  it('แจ้งข้อมูลที่ยังขาดแทนการพิมพ์ใบไม่ครบ', async () => {
    await db.exec(`update contacts set tax_id=null, address=null, person_kind=null`);
    const id = await payWithCert([line('53101', 10000, { wht_rate: 3 })]);
    expect((await data(id)).missing).toEqual([
      'ข้อมูลบริษัทผู้จ่าย', 'เลขประจำตัวผู้เสียภาษี 13 หลักของผู้ถูกหัก', 'ที่อยู่ผู้ถูกหัก', 'ประเภทบุคคลของผู้ถูกหัก']);
  });
  it('เลขผู้เสียภาษี 10 หลักของผู้ถูกหักถือว่าไม่ครบสำหรับ 50 ทวิ', async () => {
    await db.exec(PROFILE);
    await db.query(`update contacts set tax_id='0105500001'`);
    const id = await payWithCert([line('53101', 10000, { wht_rate: 3 })]);
    expect((await data(id)).missing).toEqual(['เลขประจำตัวผู้เสียภาษี 13 หลักของผู้ถูกหัก']);
  });
  it('บันทึกเล่มที่ เลขที่ ลำดับที่ ประเภทเงินได้ เงื่อนไขผู้จ่าย และเงินกองทุน', async () => {
    await db.exec(PROFILE);
    const id = await payWithCert([line('53101', 10000, { wht_rate: 3 })]);
    await db.query('select set_cert_details($1,$2::jsonb)', [id, JSON.stringify({
      book_no: '1', run_no: '25', seq_in_form: 3, income_category: '2', payer_condition: 'once', fund_sso: 750 })]);
    const d = await data(id);
    expect([d.book_no, d.run_no, d.seq_in_form, d.income_category, d.payer_condition, +d.fund_sso])
      .toEqual(['1', '25', 3, '2', 'once', 750]);
    expect(await err(db.query(`select set_cert_details($1,'{"income_category":"9"}')`, [id]))).toContain('check');
  });
  it('ใบที่ยกเลิกแล้วพิมพ์และแก้ไม่ได้', async () => {
    await db.exec(PROFILE);
    const id = await payWithCert([line('53101', 10000, { wht_rate: 3 })]);
    await db.query('select cancel_wht_cert($1)', [id]);
    expect(await err(data(id))).toContain('ยกเลิกแล้ว');
    expect(await err(db.query(`select set_cert_details($1,'{"book_no":"1"}')`, [id]))).toContain('ใช้งานอยู่');
  });
});
