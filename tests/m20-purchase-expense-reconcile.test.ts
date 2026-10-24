import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';

const dir = new URL('../supabase/migrations/', import.meta.url);
let db: PGlite; let v1: string, prod: string;
const ACCOUNTS: [string, string, string][] = [
  ['11112', 'เงินสด', 'asset'], ['11122', 'ธนาคาร', 'asset'], ['11500', 'สินค้าคงเหลือ', 'asset'], ['12612', 'ค่าบริการ', 'expense'], ['53110', 'ค่าเช่า', 'expense'],
  ['17113', 'ภาษีซื้อ', 'asset'], ['21311', 'เจ้าหนี้การค้า', 'liability'], ['21399', 'เจ้าหนี้อื่น', 'liability'], ['52110', 'ค่าธรรมเนียมธนาคาร', 'expense'], ['27124', 'ภาษีหัก ณ ที่จ่ายค้างจ่าย', 'liability'], ['27121', 'ภงด ค้างจ่าย', 'liability'], ['27122', 'ภงด ค้างจ่าย 2', 'liability'], ['27123', 'ภงด ค้างจ่าย 3', 'liability'],
];
const D = '2026-10-15';
const one = async <T = any>(q: string, a: unknown[] = []) => (await db.query<any>(q, a)).rows[0] as T;
const ri = async (h: object, lines: object[]) =>
  (await one<any>('select save_goods_receipt($1::jsonb,$2::jsonb) id', [JSON.stringify({ date: D, contact: v1, ...h }), JSON.stringify(lines)])).id as string;
const ex = async (h: object, lines: object[]) =>
  (await one<any>('select save_expense($1::jsonb,$2::jsonb) id', [JSON.stringify({ date: D, contact: v1, ...h }), JSON.stringify(lines)])).id as string;
const rec = async (from: string | null = null, to: string | null = null) => (await one<any>('select purchase_expense_reconcile($1::date,$2::date) r', [from, to])).r;
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

describe('M20 รายงานซื้อ/ค่าใช้จ่ายตรงกับบัญชี', () => {
  it('RI + EXP หลายบัญชี ส่วนลด ราคารวม VAT ยกเว้นภาษี: ผลต่าง = 0 และแยกสินค้าคงเหลือกับค่าใช้จ่าย', async () => {
    await ri({}, [L({ discount_type: 'percent', discount_value: 10 })]);                                  // 2160
    await ri({ price_mode: 'inclusive' }, [L({ qty: 1, unit_price: 107 }), L({ qty: 1, unit_price: 100, vat: 'exempt' })]); // 100 + 100
    await ex({}, [E(), E({ account: '53110', unit_price: 5000, vat: '0' }), E({ unit_price: 400, discount_type: 'amount', discount_value: 100 })]);
    const r = await rec();
    expect(+r.doc.ri).toBe(2360); expect(+r.doc.exp).toBe(1000 + 5000 + 300); expect(+r.doc.total).toBe(2360 + 6300);
    expect(+r.diff).toBe(0); expect(+r.vat_diff).toBe(0);
    expect(r.gl.by_account.find((a: any) => a.code === '11500').amount).toBe(2360 as any);
    expect(r.doc.exp_by_account.map((a: any) => [a.code, +a.amount])).toEqual([['12612', 1300], ['53110', 5000]]);
  });

  it('ไม่อนุมัติ/ยกเลิก: ไม่อยู่ในเอกสารและบัญชีหักล้างแล้ว · รออนุมัติยังนับ (บัญชีลงตั้งแต่สร้าง)', async () => {
    const a = await ex({}, [E()]); const b = await ex({}, [E({ unit_price: 300 })]); await ex({}, [E({ unit_price: 200 })]);
    const c = await ri({}, [L()]);
    await db.query('select reject_expense($1)', [a]); await db.query('select cancel_expense($1)', [b]); await db.query('select cancel_goods_receipt($1)', [c]);
    const r = await rec();
    expect(+r.doc.total).toBe(200); expect(+r.diff).toBe(0); expect(+r.vat_diff).toBe(0);
  });

  it('จ่ายเงินพร้อมหัก ณ ที่จ่าย ไม่ทำให้ยอดค่าใช้จ่ายเปลี่ยน', async () => {
    const e = await ex({}, [E({ wht_rate: 3 })]); await db.query('select approve_expense($1)', [e]);
    const before = await rec();
    await db.query(`select pay_expense($1,$2::date,'11112')`, [e, D]);
    const after = await rec();
    expect(+after.doc.total).toBe(+before.doc.total); expect(+after.diff).toBe(0);
  });

  it('JV/รายการอื่นที่เดบิตค่าใช้จ่ายแสดงแยก ไม่ปนในยอดซื้อ', async () => {
    await ex({}, [E()]);
    await db.query(`select post_voucher('JV',$1::date,'ค่าธรรมเนียม',null,null,$2::jsonb)`, [D, JSON.stringify([{ account: '52110', debit: 35 }, { account: '11122', credit: 35 }])]);
    const r = await rec();
    expect(+r.doc.total).toBe(1000); expect(+r.diff).toBe(0);
    expect(r.gl.other_expense).toEqual([{ source: 'JV', code: '52110', name: 'ค่าธรรมเนียมธนาคาร', amount: 35 }]);
  });

  it('กรองตามช่วงวันที่', async () => {
    await ex({ date: '2026-09-10' }, [E()]); await ex({ date: '2026-10-10' }, [E({ unit_price: 300 })]);
    const r = await rec('2026-10-01', '2026-10-31');
    expect(+r.doc.total).toBe(300); expect(+r.diff).toBe(0);
  });
});
