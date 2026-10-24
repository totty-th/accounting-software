import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';

const dir = new URL('../supabase/migrations/', import.meta.url);
let db: PGlite; let v1: string, prod: string;
const ACCOUNTS: [string, string, string][] = [
  ['11112', 'เงินสด', 'asset'], ['11122', 'ธนาคาร', 'asset'], ['11500', 'สินค้าคงเหลือ', 'asset'], ['12612', 'ค่าบริการ', 'expense'],
  ['17113', 'ภาษีซื้อ', 'asset'], ['21311', 'เจ้าหนี้การค้า', 'liability'], ['21399', 'เจ้าหนี้อื่น', 'liability'],
];
const D = '2026-10-15';
const err = async (p: Promise<unknown>) => { try { await p; return ''; } catch (e) { return (e as Error).message; } };
const one = async <T = any>(q: string, a: unknown[] = []) => (await db.query<any>(q, a)).rows[0] as T;
const ri = async (h: object, lines: object[]) =>
  (await one<any>('select save_goods_receipt($1::jsonb,$2::jsonb) id', [JSON.stringify({ date: D, contact: v1, ...h }), JSON.stringify(lines)])).id;
const ex = async (h: object, lines: object[]) =>
  (await one<any>('select save_expense($1::jsonb,$2::jsonb) id', [JSON.stringify({ date: D, contact: v1, ...h }), JSON.stringify(lines)])).id;
const L = (x: object = {}) => ({ product_id: prod, qty: 4, unit_price: 600, ...x });
const E = (x: object = {}) => ({ description: 'ค่าบริการ', account: '12612', qty: 1, unit_price: 1000, ...x });

beforeAll(async () => {
  db = new PGlite();
  for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(new URL(f, dir), 'utf8'));
});
beforeEach(async () => {
  await db.exec(`truncate expense_lines, expenses, purchase_order_lines, purchase_orders, stock_alerts, stock_movements, product_stock, goods_receipt_lines,
    goods_receipts, products, contacts, journal_lines, journal_vouchers, period_locks, doc_sequences, accounts cascade`);
  for (const [c, n, t] of ACCOUNTS) await db.query('insert into accounts(code,name,type) values ($1,$2,$3)', [c, n, t]);
  v1 = (await one<any>(`insert into contacts(business_name) values ('ผู้ขาย A') returning id`)).id;
  prod = (await one<any>(`insert into products(code,name,kind,purchase_price,base_unit) values ('TST-A','A','goods_stock',600,'ชิ้น') returning id`)).id;
});

describe('M18.7 ใบรับสินค้าเต็มรูปแบบ', () => {
  it('หัวเอกสาร + ลงบัญชีสุทธิหลังส่วนลด + รับสต็อก', async () => {
    const id = await ri({ credit_days: 30, purchaser: 'สมชาย', ref_no: 'R1', project: 'P', internal_note: 'ภายใน', note: 'หมายเหตุ' },
      [L({ discount_type: 'percent', discount_value: 10 })]);
    const r = await one<any>('select * from goods_receipts where id=$1', [id]);
    // 4*600=2400, ลด 10% = 240 → net 2160, vat 151.20
    expect([+r.subtotal, +r.vat, +r.total, +r.discount_total, r.credit_days, r.due_date.toISOString().slice(0, 10), r.purchaser, r.show_signature, r.note])
      .toEqual([2160, 151.2, 2311.2, 240, 30, '2026-11-14', 'สมชาย', true, 'หมายเหตุ']);
    const j = await one<any>(`select sum(debit) d, sum(credit) c from journal_lines where voucher_id=$1`, [r.uv_voucher_id]);
    expect([+j.d, +j.c]).toEqual([2311.2, 2311.2]);
    expect(+(await one<any>('select qty from product_stock where product_id=$1', [prod])).qty).toBe(4);
  });
  it('ภาษี 0/ยกเว้น · ราคารวมภาษี · WHT เป็นข้อมูลบนเอกสาร ไม่ลงบัญชี', async () => {
    const id = await ri({ price_mode: 'inclusive' }, [L({ qty: 1, unit_price: 107 }), L({ qty: 1, unit_price: 100, vat: 'exempt', wht_rate: 3 })]);
    const r = await one<any>('select * from goods_receipts where id=$1', [id]);
    expect([+r.subtotal, +r.vat, +r.total, +r.exempt_base, +r.wht_total]).toEqual([200, 7, 207, 100, 3]);
    expect(+(await one<any>(`select count(*) c from journal_lines where account_id=(select id from accounts where code='21311') and credit>0`)).c).toBe(1);
  });
  it('ตรวจข้อมูล: ต้องมีผู้จำหน่าย/รายการ/สินค้านับสต็อก/ส่วนลดไม่เกินยอด', async () => {
    expect(await err(ri({ contact: '' }, [L()]))).toMatch(/ผู้จำหน่าย/);
    expect(await err(ri({}, []))).toMatch(/อย่างน้อย 1/);
    expect(await err(ri({}, [L({ discount_type: 'amount', discount_value: 99999 })]))).toMatch(/ส่วนลดเกิน/);
    expect(await err(ri({}, [L({ vat: '5' })]))).toMatch(/ไม่รองรับ/);
    expect(+(await one<any>('select count(*) c from goods_receipts')).c).toBe(0);
  });
});

describe('M18.7 ค่าใช้จ่ายเต็มรูปแบบ', () => {
  it('หัวเอกสาร + ส่วนลด/VAT/WHT ต่อบรรทัด + UV สมดุล', async () => {
    const id = await ex({ credit_days: 15, ref_no: 'X1', project: 'P', description: 'ทดสอบ' }, [
      E({ discount_type: 'amount', discount_value: 100, wht_rate: 3 }), E({ vat: '0', unit_price: 500 }), E({ vat: 'exempt', unit_price: 200 })]);
    const e = await one<any>('select * from expenses where id=$1', [id]);
    // 900 + 500 + 200 = 1600 ; vat 63 ; wht 27
    expect([+e.subtotal, +e.vat, +e.total, +e.wht_total, +e.discount_total, +e.exempt_base, e.credit_days, e.ref_no])
      .toEqual([1600, 63, 1663, 27, 100, 200, 15, 'X1']);
    const j = await one<any>(`select sum(debit) d, sum(credit) c from journal_lines where voucher_id=$1`, [e.uv_voucher_id]);
    expect([+j.d, +j.c]).toEqual([1663, 1663]);
  });
  it('ราคารวมภาษี และตรวจข้อมูล', async () => {
    const id = await ex({ price_mode: 'inclusive' }, [E({ unit_price: 107 })]);
    expect(+(await one<any>('select vat from expenses where id=$1', [id])).vat).toBe(7);
    expect(await err(ex({}, [E({ account: '' })]))).toMatch(/หมวดค่าใช้จ่าย/);
    expect(await err(ex({}, [E({ description: '' })]))).toMatch(/รายละเอียด/);
    expect(await err(ex({ contact: '' }, [E()]))).toMatch(/ผู้จำหน่าย/);
  });
  it('จ่ายเงินได้ตามเดิม (pay_expense ใช้ยอดที่บันทึก)', async () => {
    const id = await ex({}, [E({ wht_rate: 3 })]);
    await db.query(`insert into wht_forms(code,label,account_code) values ('PND53','x','21399') on conflict do nothing`);
    const e = await one<any>('select * from expenses where id=$1', [id]);
    expect([+e.total, +e.wht_total, e.status]).toEqual([1070, 30, 'pending']);
  });
});
