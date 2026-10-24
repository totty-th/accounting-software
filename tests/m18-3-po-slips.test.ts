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

describe('M18.3 ใบสั่งซื้อ (PO)', () => {
  it('สร้าง PO ไม่ลงบัญชี ไม่ขยับสต็อก · เลข PO รายวัน', async () => {
    const id = await po();
    const p = await one<any>('select * from purchase_orders where id=$1', [id]);
    expect([p.po_no, p.status, +p.total]).toEqual(['PO202610150001', 'pending', 2568]);
    expect(+(await one<any>('select count(*) c from journal_vouchers')).c).toBe(0);
    expect(+(await one<any>('select count(*) c from stock_movements')).c).toBe(0);
  });
  it('อนุมัติ / ไม่อนุมัติ / รีเซ็ต วนได้', async () => {
    const id = await po();
    await call('select approve_purchase_order($1)', [id]); expect(await st('purchase_orders', id)).toBe('approved');
    await call('select reject_purchase_order($1)', [id]); expect(await st('purchase_orders', id)).toBe('rejected');
    await call('select reset_purchase_order($1)', [id]); expect(await st('purchase_orders', id)).toBe('pending');
    expect(await err(call('select reset_purchase_order($1)', [id]))).toContain('รีเซ็ตได้เฉพาะ');
  });
  it('อัปเกรดเป็น RI: PO ดำเนินการแล้ว, RI รออนุมัติ อ้างอิงเลข PO, UV + สต็อกเข้า', async () => {
    const id = await po();
    const r = (await one<any>('select upgrade_po_to_ri($1) id', [id])).id;
    const g = await one<any>('select * from goods_receipts where id=$1', [r]);
    expect([g.status, g.ref_no, g.po_id, +g.total]).toEqual(['unpaid', 'PO202610150001', id, 2568]);
    expect(await st('purchase_orders', id)).toBe('converted');
    expect(+(await one<any>('select stock_on_hand($1) v', [prod])).v).toBe(4);
    expect(await tb('21311')).toBe(-2568);
    expect(await err(call('select upgrade_po_to_ri($1)', [id]))).toContain('รออนุมัติหรืออนุมัติแล้ว');
    expect(await err(call('select reset_purchase_order($1)', [id]))).toContain('ยังไม่ทดสอบ');
    expect(await err(call('select cancel_purchase_order($1)', [id]))).toContain('ยังไม่ดำเนินการ');
  });
});

describe('M18.3 ใบเตรียมจ่าย หลายผู้จำหน่าย', () => {
  it('สร้างใบรวม EXP + RI ของ 2 ผู้จำหน่าย ไม่ลงบัญชี', async () => {
    const e = await ex(v1, 1000), r = await ri(v2);
    const n = +(await one<any>('select count(*) c from journal_vouchers')).c;
    const s = await slip([{ type: 'EXP', id: e }, { type: 'RI', id: r }]);
    expect((await one<any>('select pay_no from payment_slips where id=$1', [s])).pay_no).toBe('PAY202610150001');
    expect(+(await one<any>('select count(*) c from journal_vouchers')).c).toBe(n);
  });
  it('เอกสารเดียวอยู่ในใบเตรียมจ่ายซ้อนไม่ได้ · เอกสารที่จ่ายแล้วเลือกไม่ได้', async () => {
    const e = await ex(v1, 1000);
    await slip([{ type: 'EXP', id: e }]);
    expect(await err(slip([{ type: 'EXP', id: e }]))).toContain('อยู่ในใบเตรียมจ่ายอื่นแล้ว');
    const e2 = await ex(v1, 500); await call('select pay_expense($1,$2::date)', [e2, D]);
    expect(await err(slip([{ type: 'EXP', id: e2 }]))).toContain('จ่ายไม่ได้');
  });
  it('จ่ายทีละผู้จำหน่าย: แต่ละเอกสารได้ PV ของตัวเอง ยอดเจ้าหนี้ลด หัก ณ ที่จ่ายตามเอกสาร', async () => {
    const e1 = await ex(v1, 1000, { wht_rate: 3 }), e2 = await ex(v1, 2000), r = await ri(v2);   // v1 net 1040 + 2140 = 3180 · v2 1070
    const s = await slip([{ type: 'EXP', id: e1 }, { type: 'EXP', id: e2 }, { type: 'RI', id: r }]);
    expect((await one<any>('select pay_payment_slip_vendor($1,$2,$3::date) n', [s, v1, D])).n).toBe(2);
    expect(await st('expenses', e1)).toBe('paid'); expect(await st('expenses', e2)).toBe('paid');
    expect(await st('goods_receipts', r)).toBe('unpaid');
    expect(await tb('11112')).toBe(-3180);
    expect(await tb('27124')).toBe(-30);
    expect(await err(call('select pay_payment_slip_vendor($1,$2,$3::date)', [s, v1, D]))).toContain('ไม่มีเอกสารค้างจ่าย');
    await call('select pay_payment_slip_vendor($1,$2,$3::date)', [s, v2, D]);
    expect(await st('goods_receipts', r)).toBe('paid');
  });
  it('แบ่งช่องทางข้ามเอกสาร: โอน 2,000 + เงินสด 1,180 สำหรับ 2 เอกสาร ยอดรวมต้องตรง', async () => {
    const e1 = await ex(v1, 1000), e2 = await ex(v1, 2000);     // 1070 + 2140 = 3210
    const acc = (await one<any>(`select id from accounts where code='11122'`)).id;
    const bk = (await one<any>(`insert into bank_accounts(account_id,bank_name,account_no,account_name) values ($1,'ธ.ทดสอบ','111','บ') returning id`, [acc])).id;
    const s = await slip([{ type: 'EXP', id: e1 }, { type: 'EXP', id: e2 }]);
    const pays = [{ method: 'transfer', bank_account_id: bk, amount: 2000 }, { method: 'cash', amount: 1210 }];
    expect(await err(call('select pay_payment_slip_vendor($1,$2,$3::date,$4::jsonb)', [s, v1, D, JSON.stringify([{ method: 'cash', amount: 1 }])])))
      .toContain('ไม่เท่ายอดจ่ายสุทธิ');
    await call('select pay_payment_slip_vendor($1,$2,$3::date,$4::jsonb)', [s, v1, D, JSON.stringify(pays)]);
    expect(await tb('11122')).toBe(-2000);
    expect(await tb('11112')).toBe(-1210);
    const rows = (await db.query<any>('select doc_id, method, amount from purchase_payments order by doc_id, line_no')).rows;
    expect(rows.reduce((a: number, x: any) => a + +x.amount, 0)).toBe(3210);
    expect(rows.filter((x: any) => x.doc_id === e1).reduce((a: number, x: any) => a + +x.amount, 0)).toBe(1070);
  });
  it('ยกเลิกใบเตรียมจ่าย: ได้ถ้ายังไม่จ่าย · ปล่อยเอกสารกลับไปเลือกใหม่ได้ · จ่ายแล้วยกเลิกไม่ได้', async () => {
    const e = await ex(v1, 1000), e2 = await ex(v2, 500);
    const s = await slip([{ type: 'EXP', id: e }]);
    await call('select cancel_payment_slip($1)', [s]);
    await slip([{ type: 'EXP', id: e }]);   // เลือกใหม่ได้
    const s2 = await slip([{ type: 'EXP', id: e2 }]);
    await call('select pay_payment_slip_vendor($1,$2,$3::date)', [s2, v2, D]);
    expect(await err(call('select cancel_payment_slip($1)', [s2]))).toContain('จ่ายแล้ว');
  });
});
