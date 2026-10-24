import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';

const dir = new URL('../supabase/migrations/', import.meta.url);
let db: PGlite;
let v1: string, prod: string;
const ACCOUNTS: [string, string, string][] = [
  ['11112', 'เงินสด', 'asset'], ['11500', 'สินค้าคงเหลือ', 'asset'], ['17113', 'ภาษีซื้อ', 'asset'],
  ['21311', 'เจ้าหนี้การค้า', 'liability'], ['21399', 'เจ้าหนี้อื่นๆ', 'liability'], ['27124', 'ภาษีหัก ณ ที่จ่าย', 'liability'], ['53101', 'ค่าบริการ', 'expense'],
];
const D = '2026-10-15';
const err = async (p: Promise<unknown>) => { try { await p; return ''; } catch (e) { return (e as Error).message; } };
const one = async <T = any>(q: string, a: unknown[] = []) => (await db.query<any>(q, a)).rows[0] as T;
const call = (q: string, a: unknown[] = []) => db.query(q, a);
const ex = async (price = 1000, extra: object = {}) => (await one<any>('select create_expense($1::date,$2,$3::jsonb) id',
  [D, v1, JSON.stringify([{ description: 'x', account: '53101', qty: 1, unit_price: price, ...extra }])])).id;
const ri = async () => (await one<any>('select create_goods_receipt($1::date,$2,$3::jsonb) id',
  [D, v1, JSON.stringify([{ product_id: prod, qty: 2, unit_price: 600 }])])).id;
const nV = async () => +(await one<any>('select count(*) c from journal_vouchers')).c;

beforeAll(async () => {
  db = new PGlite();
  for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(new URL(f, dir), 'utf8'));
});
beforeEach(async () => {
  await db.exec(`truncate wht_cert_lines, purchase_tax_invoices, payment_slip_items, payment_slips, purchase_order_lines, purchase_orders,
    purchase_payments, stock_alerts, stock_movements, product_stock, goods_receipt_lines, goods_receipts, products, wht_certs, expense_lines, expenses,
    contacts, journal_lines, journal_vouchers, period_locks, doc_sequences, accounts, company_profile cascade`);
  for (const [c, n, t] of ACCOUNTS) await db.query('insert into accounts(code,name,type) values ($1,$2,$3)', [c, n, t]);
  v1 = (await one<any>(`insert into contacts(business_name, tax_id, address, person_kind) values ('ผู้ขาย A','0105500000001','1 ถ.ทดสอบ','juristic') returning id`)).id;
  prod = (await one<any>(`insert into products(code,name,kind,purchase_price) values ('TST-A','A','goods_stock',600) returning id`)).id;
  await db.query(`insert into company_profile(name,address,tax_id,person_kind) values ('บริษัททดสอบ','9 ถ.ใหญ่','0105500000099','juristic')`);
});

describe('M18.4 ข้อมูลใบกำกับภาษีที่ได้รับ', () => {
  it('ไม่ระบุ = ดึงผู้จำหน่าย/ฐาน/VAT จากเอกสาร · ไม่ลงบัญชี', async () => {
    const id = await ex(1000); const n = await nV();
    await call(`select set_purchase_tax_invoice('EXP',$1,$2::jsonb)`, [id, JSON.stringify({ invoice_no: 'IV-001' })]);
    const t = await one<any>('select * from purchase_tax_invoices');
    expect([t.invoice_no, t.vat_form, t.vendor_name, t.vendor_tax_id, +t.base_amount, +t.vat_amount]).toEqual(['IV-001', 'PP30', 'ผู้ขาย A', '0105500000001', 1000, 70]);
    expect(await nV()).toBe(n);
  });
  it('แก้ไขซ้ำทับของเดิม · ต้องมีเลขที่ · เลขภาษีต้อง 13 หลัก · ล้างได้', async () => {
    const id = await ri();
    expect(await err(call(`select set_purchase_tax_invoice('RI',$1,$2::jsonb)`, [id, '{}']))).toContain('เลขที่ใบกำกับภาษี');
    expect(await err(call(`select set_purchase_tax_invoice('RI',$1,$2::jsonb)`, [id, JSON.stringify({ invoice_no: 'A', vendor_tax_id: '123' })]))).toContain('vendor_tax_id');
    await call(`select set_purchase_tax_invoice('RI',$1,$2::jsonb)`, [id, JSON.stringify({ invoice_no: 'A' })]);
    await call(`select set_purchase_tax_invoice('RI',$1,$2::jsonb)`, [id, JSON.stringify({ invoice_no: 'B', vat_form: 'PP36', base_amount: 1200, vat_amount: 84 })]);
    const rows = (await db.query<any>('select * from purchase_tax_invoices')).rows;
    expect(rows.length).toBe(1); expect([rows[0].invoice_no, rows[0].vat_form, +rows[0].vat_amount]).toEqual(['B', 'PP36', 84]);
    await call(`select clear_purchase_tax_invoice('RI',$1)`, [id]);
    expect(+(await one<any>('select count(*) c from purchase_tax_invoices')).c).toBe(0);
  });
  it('รายงานไม่นับเอกสารที่ไม่อนุมัติ/ยกเลิก', async () => {
    const a = await ex(1000), b = await ex(2000);
    for (const [i, x] of [[a, 'A1'], [b, 'B1']] as const) await call(`select set_purchase_tax_invoice('EXP',$1,$2::jsonb)`, [i, JSON.stringify({ invoice_no: x })]);
    const n = async () => (await db.query<any>(`select * from purchase_tax_invoice_report('2026-10-01','2026-10-31')`)).rows.length;
    expect(await n()).toBe(2);
    await call('select reject_expense($1)', [b]);
    expect(await n()).toBe(1);
    expect(await err(call(`select set_purchase_tax_invoice('EXP',$1,$2::jsonb)`, [b, JSON.stringify({ invoice_no: 'Z' })]))).toContain('ไม่อนุมัติ');
  });
});

describe('M18.4 หัก ณ ที่จ่ายแบบเอกสารอิสระ', () => {
  it('คำนวณหลายบรรทัด (อัตรา, รวม VAT, ระบุภาษีเอง) ไม่ลงบัญชี เลข WT รายวัน', async () => {
    const n = await nV();
    const id = (await one<any>(`select create_standalone_wht($1::date,$2,'PND53',$3::jsonb) id`, [D, v1, JSON.stringify([
      { income_type: 'ค่าบริการ', rate: 3, amount: 1000 },
      { income_type: 'ค่าเช่า', rate: 5, amount: 1070, vat_mode: 'inclusive' },
      { income_type: 'อื่นๆ', amount: 500, wht: 10 }])])).id;
    const c = await one<any>('select * from wht_certs where id=$1', [id]);
    expect([c.cert_no, c.form_code, +c.base_amount, +c.wht_amount, c.expense_id]).toEqual(['WT202610150001', 'PND53', 2500, 30 + 50 + 10, null]);
    expect(await nV()).toBe(n);
    expect(+(await one<any>('select count(*) c from wht_cert_lines where cert_id=$1', [id])).c).toBe(3);
  });
  it('พิมพ์ 50 ทวิได้จากใบอิสระ (ผู้ถูกหักมาจาก contact) และไม่ขาดข้อมูล', async () => {
    const id = (await one<any>(`select create_standalone_wht($1::date,$2,'PND53',$3::jsonb) id`, [D, v1, JSON.stringify([{ income_type: 'ค่าบริการ', rate: 3, amount: 1000 }])])).id;
    const d = (await one<any>('select wht_cert_data($1) d', [id])).d;
    expect(d.payee.name).toBe('ผู้ขาย A'); expect(d.missing).toEqual([]); expect(+d.wht_amount).toBe(30);
  });
  it('ใบจากค่าใช้จ่ายเดิมยังพิมพ์ได้ (contact_id เติมอัตโนมัติ)', async () => {
    const id = await ex(1000, { wht_rate: 3 });
    await call('select pay_expense($1,$2::date)', [id, D]);
    const c = await one<any>('select id, contact_id from wht_certs');
    expect(c.contact_id).toBe(v1);
    expect((await one<any>('select wht_cert_data($1) d', [c.id])).d.payee.tax_id).toBe('0105500000001');
  });
  it('ตรวจแบบ/ผู้ถูกหัก/ประเภทเงินได้ · ยกเลิกได้', async () => {
    const ok = [{ income_type: 'x', rate: 3, amount: 100 }];
    expect(await err(call(`select create_standalone_wht($1::date,$2,'XX',$3::jsonb)`, [D, v1, JSON.stringify(ok)]))).toContain('ไม่พบแบบฟอร์ม');
    expect(await err(call(`select create_standalone_wht($1::date,$2,'PND3','[]'::jsonb)`, [D, v1]))).toContain('อย่างน้อย 1');
    expect(await err(call(`select create_standalone_wht($1::date,$2,'PND3',$3::jsonb)`, [D, v1, JSON.stringify([{ income_type: 'x', amount: 100 }])]))).toContain('อัตรา');
    const id = (await one<any>(`select create_standalone_wht($1::date,$2,'PND1K',$3::jsonb) id`, [D, v1, JSON.stringify(ok)])).id;
    await call('select cancel_wht_cert($1)', [id]);
    expect((await one<any>('select status from wht_certs where id=$1', [id])).status).toBe('cancelled');
  });
});

describe('M18.4 ลิงก์แชร์ PO/RI/PAY', () => {
  it('สร้างโทเคน คงเดิมเมื่อเรียกซ้ำ ค้นเอกสารได้ เพิกถอนแล้วหาไม่เจอ', async () => {
    const r = await ri();
    const t1 = (await one<any>(`select ensure_purchase_share_token('RI',$1) t`, [r])).t;
    const t2 = (await one<any>(`select ensure_purchase_share_token('RI',$1) t`, [r])).t;
    expect(t1).toBe(t2); expect(t1.length).toBe(26);
    const f = await one<any>('select * from purchase_doc_by_token($1)', [t1]);
    expect([f.kind, f.id]).toEqual(['RI', r]);
    await call(`select revoke_purchase_share_token('RI',$1)`, [r]);
    expect(await one<any>('select * from purchase_doc_by_token($1)', [t1])).toBeUndefined();
    expect(await err(call(`select ensure_purchase_share_token('XX',$1)`, [r]))).toContain('ชนิดเอกสาร');
  });
  it('PO และ PAY ก็แชร์ได้', async () => {
    const po = (await one<any>(`select create_purchase_order($1::date,$2,$3::jsonb) id`, [D, v1, JSON.stringify([{ product_id: prod, qty: 1, unit_price: 600 }])])).id;
    const e = await ex(1000);
    const s = (await one<any>(`select create_payment_slip($1::date,$1::date,$2::jsonb) id`, [D, JSON.stringify([{ type: 'EXP', id: e }])])).id;
    for (const [k, id] of [['PO', po], ['PAY', s]] as const) {
      const t = (await one<any>(`select ensure_purchase_share_token($1,$2) t`, [k, id])).t;
      expect((await one<any>('select kind from purchase_doc_by_token($1)', [t])).kind).toBe(k);
    }
  });
});
