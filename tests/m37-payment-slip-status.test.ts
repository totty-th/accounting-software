import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';

const dir = new URL('../supabase/migrations/', import.meta.url);
let db: PGlite;
let v1: string, v2: string, prod: string;
const ACCOUNTS: [string, string, string][] = [
  ['11112', 'เงินสด', 'asset'], ['11122', 'ธนาคาร', 'asset'], ['11500', 'สินค้าคงเหลือ', 'asset'],
  ['17113', 'ภาษีซื้อ', 'asset'], ['21311', 'เจ้าหนี้การค้า', 'liability'], ['21399', 'เจ้าหนี้อื่นๆ', 'liability'],
  ['27124', 'ภาษีหัก ณ ที่จ่าย', 'liability'], ['53101', 'ค่าบริการ', 'expense'],
];
const D = '2026-10-15';
const err = async (p: Promise<unknown>) => { try { await p; return ''; } catch (e) { return (e as Error).message; } };
const one = async <T = any>(q: string, a: unknown[] = []) => (await db.query<any>(q, a)).rows[0] as T;
const call = (q: string, a: unknown[] = []) => db.query(q, a);
const po = async (v = v1, qty = 4) => (await one<any>('select create_purchase_order($1::date,$2,$3::jsonb) id',
  [D, v, JSON.stringify([{ product_id: prod, qty, unit_price: 600 }])])).id;
const ex = async (v: string, price: number, extra: object = {}) => (await one<any>('select create_expense($1::date,$2,$3::jsonb) id',
  [D, v, JSON.stringify([{ description: 'x', account: '53101', qty: 1, unit_price: price, ...extra }])])).id;
const ri = async (v: string, qty = 1) => (await one<any>('select create_goods_receipt($1::date,$2,$3::jsonb) id',
  [D, v, JSON.stringify([{ product_id: prod, qty, unit_price: 1000 }])])).id;
const slip = async (docs: object[]) => (await one<any>('select create_payment_slip($1::date,$1::date,$2::jsonb) id', [D, JSON.stringify(docs)])).id;
const tb = async (code: string) =>
  +((await one<any>(`select coalesce(sum(closing),0) c from trial_balance('2026-10-01','2026-10-31',false) where code=$1`, [code])).c);
const st = async (t: string, id: string) => (await one<any>(`select status from ${t} where id=$1`, [id])).status;

beforeAll(async () => {
  db = new PGlite();
  for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(new URL(f, dir), 'utf8'));
});
beforeEach(async () => {
  await db.exec(`truncate payment_slip_items, payment_slips, purchase_order_lines, purchase_orders, purchase_payments, stock_alerts,
    stock_movements, product_stock, goods_receipt_lines, goods_receipts, products, wht_certs, expense_lines, expenses, contacts,
    journal_lines, journal_vouchers, period_locks, doc_sequences, accounts cascade`);
  for (const [c, n, t] of ACCOUNTS) await db.query('insert into accounts(code,name,type) values ($1,$2,$3)', [c, n, t]);
  v1 = (await one<any>(`insert into contacts(business_name) values ('ผู้ขาย A') returning id`)).id;
  v2 = (await one<any>(`insert into contacts(business_name) values ('ผู้ขาย B') returning id`)).id;
  prod = (await one<any>(`insert into products(code,name,kind,purchase_price) values ('TST-A','A','goods_stock',600) returning id`)).id;
});

const slipOf = async (id: string) => await one<any>('select * from payment_slips where id=$1', [id]);
describe('M37 สถานะใบเตรียมจ่ายตามต้นแบบ (REA 01-11-2026)', () => {
  it('รอดำเนินการ→จ่าย→รับใบเสร็จ→รีเซ็ตกลับรายการจ่ายทุกเอกสาร', async () => {
    const e = await ex(v1, 1000); const r = await ri(v1); const s = await slip([{ type: 'EXP', id: e }, { type: 'RI', id: r }]);
    expect(await err(call('select receive_payment_slip($1)', [s]))).toContain('จ่ายครบ');
    expect(await err(call('select reset_payment_slip($1)', [s]))).toContain('ไม่มีรายการที่จ่ายแล้ว');
    await call('select pay_payment_slip_vendor($1,$2,$3::date)', [s, v1, D]);
    expect(await st('expenses', e)).toBe('paid'); expect(await st('goods_receipts', r)).toBe('paid');
    await call('select receive_payment_slip($1)', [s]); expect((await slipOf(s)).receipt_received).toBe(true);
    expect(await err(call('select delete_payment_slip($1)', [s]))).toContain('ไม่สามารถลบเอกสารได้');
    await call('select reset_payment_slip($1)', [s]);
    expect((await slipOf(s)).receipt_received).toBe(false);
    expect(await st('expenses', e)).not.toBe('paid'); expect(await st('goods_receipts', r)).not.toBe('paid');
    expect((await slipOf(s)).status).toBe('active');           // กลับเป็นรอดำเนินการ ใบยังอยู่
    await call('select pay_payment_slip_vendor($1,$2,$3::date)', [s, v1, D]);   // จ่ายใหม่ได้
    expect(await st('expenses', e)).toBe('paid');
  });
  it('ลบได้เฉพาะที่ยังไม่จ่าย · เอกสารกลับไปเลือกใหม่ได้ · แก้หัวเอกสารได้เมื่อใช้งานอยู่', async () => {
    const e = await ex(v1, 500); const s = await slip([{ type: 'EXP', id: e }]);
    await call('select update_payment_slip($1,$2::date,$3,$4,$5,$6,$7,$8)', [s, D, 'ผู้จัดเตรียม', 'ผู้ขอ', 'ผู้อนุมัติ', 'เหตุผล', 'หมายเหตุ', 'โน้ต']);
    const h = await slipOf(s); expect([h.preparer, h.reason, h.note, h.internal_note]).toEqual(['ผู้จัดเตรียม', 'เหตุผล', 'หมายเหตุ', 'โน้ต']);
    await call('select delete_payment_slip($1)', [s]);
    expect(+(await one<any>('select count(*) c from payment_slips')).c).toBe(0);
    const e2 = await ex(v1, 500); const s2 = await slip([{ type: 'EXP', id: e2 }]); expect(s2).toBeTruthy();
    await call('select cancel_payment_slip($1)', [s2]);
    expect(await err(call('select update_payment_slip($1,$2::date,null,null,null,null,null,null)', [s2, D]))).toContain('ยกเลิกแล้ว');
    expect(await err(call('select delete_payment_slip($1)', [s2]))).toContain('ไม่สามารถลบเอกสารได้');   // ใบที่ยกเลิกลบไม่ได้ (รอบ 2)
  });
});
