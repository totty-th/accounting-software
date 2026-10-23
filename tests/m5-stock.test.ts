import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';

const dir = new URL('../supabase/migrations/', import.meta.url);
let db: PGlite;
let cust: string, vendor: string, prod: string, mainWh: string;
const ACCOUNTS: [string, string, string][] = [
  ['11112', 'เงินสด', 'asset'], ['11311', 'ลูกหนี้', 'asset'], ['11319', 'ใบเสร็จรอเรียกเก็บ', 'asset'],
  ['11500', 'สินค้าคงเหลือ', 'asset'], ['17113', 'ภาษีซื้อยังไม่ถึงกำหนด', 'asset'],
  ['21311', 'เจ้าหนี้การค้า', 'liability'], ['27111', 'ภาษีขาย', 'liability'],
  ['41110', 'รายได้ขายสินค้า', 'revenue'], ['41210', 'รายได้บริการ', 'revenue'], ['51100', 'ต้นทุนขาย', 'expense'],
];
const D = '2026-10-15';
const err = async (p: Promise<unknown>) => { try { await p; return ''; } catch (e) { return (e as Error).message; } };
const one = async <T = any>(q: string, a: unknown[] = []) => (await db.query<any>(q, a)).rows[0] as T;
const call = (q: string, a: unknown[] = []) => db.query(q, a);
async function entries(v: string) {
  const r = await db.query<any>(`select a.code, l.debit, l.credit from journal_lines l join accounts a on a.id=l.account_id
    where voucher_id=$1 order by line_no`, [v]);
  return r.rows.map(x => [x.code, +x.debit, +x.credit]);
}
const mkProduct = async (code: string, kind: string, extra: Record<string, unknown> = {}) =>
  (await one<{ id: string }>(`insert into products(code,name,kind,purchase_price,block_negative) values ($1,$1,$2,$3,$4) returning id`,
    [code, kind, extra.price ?? 600, extra.block ?? false])).id;
const ri = async (qty: number, price: number, p = prod) =>
  (await one<{ id: string }>('select create_goods_receipt($1::date,$2,$3::jsonb) as id',
    [D, vendor, JSON.stringify([{ product_id: p, qty, unit_price: price }])])).id;
const sell = async (qty: number, price = 1000, p = prod, type = 'INV', wh: string | null = null) =>
  (await one<{ id: string }>(`select create_sales_doc($1,$2::date,$3,$4::jsonb) as id`,
    [type, D, type === 'CA' ? null : cust, JSON.stringify([{ description: 'ตะแกรง', product_id: p, qty, unit_price: price, warehouse_id: wh }])])).id;
const onHand = async (p = prod, w: string | null = null) => +(await one<any>('select stock_on_hand($1,$2) v', [p, w])).v;
const ps = () => one<any>('select qty::float8 q, value::float8 v, last_avg::float8 a from product_stock where product_id=$1', [prod]);
const sd = (id: string) => one('select * from sales_docs where id=$1', [id]);
const nV = async () => +(await one<any>('select count(*) c from journal_vouchers')).c;
const tb = async (code: string) =>
  +((await one<any>(`select coalesce(sum(closing),0) c from trial_balance('2026-10-01','2026-10-31',false) where code=$1`, [code])).c);

beforeAll(async () => {
  db = new PGlite();
  for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(new URL(f, dir), 'utf8'));
});
beforeEach(async () => {
  await db.exec(`truncate stock_alerts, stock_movements, product_stock, stock_transfer_lines, stock_transfers,
    goods_receipt_lines, goods_receipts, products, wht_certs, expense_lines, expenses, receipt_items, receipts,
    billing_note_items, sales_doc_lines, sales_docs, contacts, journal_lines, journal_vouchers, period_locks,
    doc_sequences, accounts cascade`);
  await db.exec('delete from warehouses where not is_main');
  for (const [c, n, t] of ACCOUNTS) await db.query('insert into accounts(code,name,type) values ($1,$2,$3)', [c, n, t]);
  cust = (await one<{ id: string }>(`insert into contacts(business_name) values ('ลูกค้า') returning id`)).id;
  vendor = (await one<{ id: string }>(`insert into contacts(business_name) values ('ผู้ขาย') returning id`)).id;
  prod = await mkProduct('TST-A', 'goods_stock');
  mainWh = (await one<any>('select main_warehouse() id')).id;
});

describe('PUR-07 ใบรับสินค้า (D-01 แบบ B)', () => {
  it('รับ 10@600 (+VAT): Dr สินค้าคงเหลือ 6,000 + 17113 420 / Cr 21311 6,420 · สต็อก +10', async () => {
    const id = await ri(10, 600);
    const r = await one<any>('select * from goods_receipts where id=$1', [id]);
    expect([r.ri_no, +r.subtotal, +r.vat, +r.total]).toEqual(['RI202610150001', 6000, 420, 6420]);
    expect(await entries(r.uv_voucher_id)).toEqual([['11500', 6000, 0], ['17113', 420, 0], ['21311', 0, 6420]]);
    expect(await onHand()).toBe(10);
    expect(await ps()).toMatchObject({ q: 10, v: 6000, a: 600 });
  });
  it('รับสินค้าที่ไม่ใช่สินค้านับสต็อกไม่ได้', async () => {
    const svc = await mkProduct('SVC', 'service');
    expect(await err(ri(1, 1, svc))).toContain('สินค้านับสต็อก');
  });
  it('จ่ายเงิน Dr 21311 / Cr 11112', async () => {
    const id = await ri(10, 600);
    const v = (await one<any>('select pay_goods_receipt($1,$2::date) v', [id, D])).v;
    expect(await entries(v)).toEqual([['21311', 6420, 0], ['11112', 0, 6420]]);
    expect(await tb('21311')).toBe(0);
  });
});

describe('STK-03/13/14 ตัดสต็อกและต้นทุนขาย moving average (AT-09)', () => {
  it('ขาย 3 ที่ต้นทุน 600: ตัดสต็อก มูลค่า 4,200 · ไม่ลงบัญชีต้นทุนขาย (ตามต้นแบบ)', async () => {
    await ri(10, 600);
    const inv = await sd(await sell(3));
    expect(await onHand()).toBe(7);
    expect(inv.cogs_voucher_id).toBeNull();
    expect(await ps()).toMatchObject({ q: 7, v: 4200 });
  });
  it('รับ 10@800 หลังขาย 3 → ต้นทุนเฉลี่ย 717.6471 มูลค่า 12,200', async () => {
    await ri(10, 600); await sell(3); await ri(10, 800);
    expect(await ps()).toMatchObject({ q: 17, v: 12200, a: 717.6471 });
  });
  it('ขาย 20 เกินคงเหลือ: ผ่านพร้อมคำเตือน คงเหลือ −3 ยกเลิกแล้วกลับ 17 / 12,200', async () => {
    await ri(10, 600); await sell(3); await ri(10, 800);
    const inv = await sd(await sell(20));
    expect(await onHand()).toBe(-3);
    expect(+(await one<any>(`select shortfall s from stock_alerts where doc_id=$1`, [inv.id])).s).toBe(3);
    await call('select cancel_sales_doc($1)', [inv.id]);
    expect(await onHand()).toBe(17);
    expect(await ps()).toMatchObject({ q: 17, v: 12200 });
    const rev = await db.query<any>(`select voucher_no from journal_vouchers where voucher_no like '%-R'`);
    expect(rev.rows).toHaveLength(1);   // SV-R (ไม่มีใบต้นทุนขาย)
  });
  it('ขายหมดสต็อกพอดี ต้นทุน = มูลค่าที่เหลือทั้งหมด ไม่เหลือเศษสตางค์', async () => {
    await ri(3, 100);   // 300
    await ri(3, 100.01); // 300.03 รวม 600.03 / 6
    await sell(6);
    expect(await ps()).toMatchObject({ q: 0, v: 0 });
    expect(await tb('11500')).toBe(600.03);   // บัญชีมีแต่ใบรับสินค้า ไม่มีการตัดต้นทุน
  });
  it('D-03 สินค้าตั้งบล็อก: ขายเกินไม่ได้ ไม่เหลือเอกสารหรือรายการค้าง', async () => {
    const p = await mkProduct('BLK', 'goods_stock', { block: true });
    await ri(2, 100, p);
    const before = await nV();
    expect(await err(sell(3, 1000, p))).toContain('สต็อกไม่พอ');
    expect(await nV()).toBe(before);
    expect((await db.query('select 1 from sales_docs')).rows).toHaveLength(0);
    expect(await onHand(p)).toBe(2);
  });
  it('ขายสด (CA) ตัดสต็อกด้วย · สินค้าไม่นับสต็อกและบริการไม่มีการเคลื่อนไหว', async () => {
    await ri(10, 600);
    const ca = await sd(await sell(2, 1000, prod, 'CA'));
    expect(await onHand()).toBe(8);
    expect(ca.cogs_voucher_id).toBeNull();
    const ns = await mkProduct('NS', 'goods_nostock');
    const sv = await mkProduct('SV', 'service');
    const a = await sd(await sell(5, 10, ns)); const b = await sd(await sell(1, 10, sv));
    expect([a.cogs_voucher_id, b.cogs_voucher_id]).toEqual([null, null]);
    expect(+(await one<any>('select count(*) c from stock_movements where product_id in ($1,$2)', [ns, sv])).c).toBe(0);
  });
  it('การขาย/ยกเลิกไม่แตะบัญชีสินค้าคงเหลือ (ตามต้นแบบ ไม่ลงต้นทุน)', async () => {
    await ri(10, 600); const i1 = await sell(3); await ri(10, 800); await sell(5);
    await call('select cancel_sales_doc($1)', [i1]);
    expect(await tb('11500')).toBe(14000);   // ใบรับสินค้า 6,000 + 8,000 เท่านั้น
  });
});

describe('ยกเลิกใบรับสินค้า', () => {
  it('ห้ามถ้าสต็อกถูกใช้ไปแล้ว · ยกเลิกได้เมื่อยังไม่ถูกใช้ และ UV ได้ -R', async () => {
    const a = await ri(10, 600);
    const b = await ri(10, 800);
    await sell(15);
    expect(await err(call('select cancel_goods_receipt($1)', [b]))).toContain('ถูกใช้ไปแล้ว');
    const c = await ri(5, 700);
    await call('select cancel_goods_receipt($1)', [c]);
    expect((await one<any>('select status from goods_receipts where id=$1', [c])).status).toBe('cancelled');
    expect(await onHand()).toBe(5);
    expect(a).toBeTruthy();
  });
  it('ยกเลิกใบที่จ่ายแล้ว: UV และ PV ได้ -R · สต็อกคืน', async () => {
    const id = await ri(10, 600);
    await call('select pay_goods_receipt($1,$2::date)', [id, D]);
    await call('select cancel_goods_receipt($1)', [id]);
    expect(await onHand()).toBe(0);
    expect(await tb('11500')).toBe(0); expect(await tb('21311')).toBe(0); expect(await tb('11112')).toBe(0);
  });
});

describe('STK-07 โอนสินค้า (AT-10)', () => {
  it('บันทึกไม่ขยับ · รับสินค้าแล้ว หลัก 12 / B 5 รวม 17 · ไม่มี JV · ต้นทุนรวมไม่เปลี่ยน', async () => {
    await ri(17, 600);
    const wb = (await one<any>(`select create_warehouse('WB','TEST Warehouse B','branch') id`)).id;
    const tf = (await one<any>('select create_transfer($1::date,$2,$3,$4::jsonb) id', [D, mainWh, wb, JSON.stringify([{ product_id: prod, qty: 5 }])])).id;
    expect(await onHand(prod, wb)).toBe(0);
    expect(await onHand(prod, mainWh)).toBe(17);
    const n = await nV(); const before = await ps();
    await call('select receive_transfer($1)', [tf]);
    expect([await onHand(prod, mainWh), await onHand(prod, wb), await onHand()]).toEqual([12, 5, 17]);
    expect(await nV()).toBe(n);
    expect(await ps()).toEqual(before);
    expect(+(await one<any>('select unit_cost u from stock_transfer_lines where tf_id=$1', [tf])).u).toBe(600);
    expect(await err(call('select receive_transfer($1)', [tf]))).toContain('รอดำเนินการ');
    expect(await err(call('select cancel_transfer($1)', [tf]))).toContain('รอดำเนินการ');
  });
  it('ยกเลิกใบโอนที่ยังไม่รับได้ · โอนคลังเดียวกันไม่ได้', async () => {
    const wb = (await one<any>(`select create_warehouse('WB','B','branch') id`)).id;
    const tf = (await one<any>('select create_transfer($1::date,$2,$3,$4::jsonb) id', [D, mainWh, wb, JSON.stringify([{ product_id: prod, qty: 1 }])])).id;
    await call('select cancel_transfer($1)', [tf]);
    expect(await err(call('select create_transfer($1::date,$2,$2,$3::jsonb)', [D, mainWh, JSON.stringify([{ product_id: prod, qty: 1 }])]))).toBeTruthy();
  });
  it('ขายจากคลังที่ระบุ ตัดเฉพาะคลังนั้น', async () => {
    await ri(10, 600);
    const wb = (await one<any>(`select create_warehouse('WB','B','branch') id`)).id;
    const tf = (await one<any>('select create_transfer($1::date,$2,$3,$4::jsonb) id', [D, mainWh, wb, JSON.stringify([{ product_id: prod, qty: 4 }])])).id;
    await call('select receive_transfer($1)', [tf]);
    await sell(3, 1000, prod, 'INV', wb);
    expect([await onHand(prod, mainWh), await onHand(prod, wb)]).toEqual([6, 1]);
  });
});

describe('STK-02 คลังสินค้า', () => {
  it('มีคลังหลัก 1 แห่ง · เพิ่มได้ไม่เกิน 50 แห่ง', async () => {
    for (let i = 1; i <= 50; i++) await call(`select create_warehouse($1,$2,'storage')`, ['W' + i, 'คลัง ' + i]);
    expect(await err(call(`select create_warehouse('W51','คลัง 51','storage')`))).toContain('ไม่เกิน 50');
    expect(await err(call(`insert into warehouses(code,name,purpose,is_main) values ('M2','x','storage',true)`))).toBeTruthy();
  });
});
