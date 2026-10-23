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
  ['41110', 'รายได้ขายสินค้า', 'revenue'], ['41210', 'รายได้บริการ', 'revenue'], ['51100', 'ต้นทุนขาย', 'expense'], ['41400', 'รับคืน', 'revenue'],
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


const mk = async (code: string) => mkProduct(code, 'goods_stock');
const inv = async (lines: any[]) =>
  (await one<{ id: string }>(`select create_sales_doc('INV',$1::date,$2,$3::jsonb) as id`, [D, cust, JSON.stringify(lines)])).id;
const adj = (type: 'CN' | 'DN', ref: string, lines: any[], reason: string | null = 'x') =>
  one<{ id: string }>(`select create_sales_doc($1,$2::date,$3,$4::jsonb,'exclusive',7,$5,$6) as id`,
    [type, D, cust, JSON.stringify(lines), ref, reason]);
let a: string, b: string, c: string;
const L = (p: string, qty: number, price: number, act?: string) =>
  ({ description: 'ตะแกรง', product_id: p, qty, unit_price: price, stock_action: act });

describe('M11 สต็อกต่อบรรทัดของ CN/DN ตามต้นแบบ', () => {
  beforeEach(async () => {
    a = prod; b = await mk('TST-B'); c = await mk('TST-C');
    for (const p of [a, b, c]) await ri(50, 600, p);
  });

  it('INV ตัดสต็อกตอนบันทึก · CN คืน/ไม่คืน/ไม่เลือก · ยกเลิก CN คืนกลับ', async () => {
    const i = await inv([L(a, 10, 1200), L(b, 8, 900), L(c, 5, 1500)]);
    expect([await onHand(a), await onHand(b), await onHand(c)]).toEqual([40, 42, 45]);
    const n0 = await nV();
    const cn = (await adj('CN', i, [L(a, 4, 1200, 'return'), L(b, 3, 900, 'no_return')])).id;
    expect([await onHand(a), await onHand(b), await onHand(c)]).toEqual([44, 42, 45]);
    // ต้นแบบไม่ลงบัญชีต้นทุน: มีแค่ใบ CN 1 ใบ
    expect(await nV()).toBe(n0 + 1);
    await call('select cancel_sales_doc($1)', [cn]);
    expect([await onHand(a), await onHand(b), await onHand(c)]).toEqual([40, 42, 45]);
  });

  it('คืนด้วยต้นทุนที่ตัดตอนขาย ไม่ใช่ต้นทุนเฉลี่ยปัจจุบัน', async () => {
    const i = await inv([L(a, 10, 1200)]);            // ตัดที่ 600
    await ri(10, 1000, a);                             // เฉลี่ยใหม่เปลี่ยน
    const before = await ps();
    await adj('CN', i, [L(a, 4, 1200, 'return')]);
    const after = await ps();
    expect(after.v - before.v).toBeCloseTo(2400, 2); // 4 x 600
    expect(after.q - before.q).toBe(4);
  });

  it('DN ตัดสต็อก/ปรับราคา · ยกเลิก DN คืนกลับ', async () => {
    const i = await inv([L(a, 10, 1200), L(c, 5, 1500)]);
    await call(`update sales_docs set status='awaiting_payment' where id=$1`, [i]);
    const dn = (await adj('DN', i, [L(a, 10, 100, 'adjust'), L(c, 2, 1500, 'cut')], 'เพิ่มราคา')).id;
    expect([await onHand(a), await onHand(c)]).toEqual([40, 43]);
    await call('select cancel_sales_doc($1)', [dn]);
    expect([await onHand(a), await onHand(c)]).toEqual([40, 45]);
  });

  it('คืนเกินจำนวนที่ขายไม่ได้ · ออก CN ซ้ำไม่ได้ (แม้ฉบับก่อนยกเลิก)', async () => {
    const i = await inv([L(a, 10, 1200)]);
    expect(await err(adj('CN', i, [L(a, 11, 1, 'return')]))).toContain('เกินจำนวน');
    const cn = (await adj('CN', i, [L(a, 8, 1200, 'return')])).id;
    expect(await err(adj('CN', i, [L(a, 2, 1200, 'return')]))).toContain('เคยถูกสร้างเป็นใบลดหนี้');
    await call('select cancel_sales_doc($1)', [cn]);
    expect(await err(adj('CN', i, [L(a, 2, 1200, 'return')]))).toContain('เคยถูกสร้างเป็นใบลดหนี้');
  });

  it('ตัวเลือกสต็อกผิดประเภทถูกปฏิเสธ', async () => {
    const i = await inv([L(a, 10, 1200)]);
    expect(await err(adj('CN', i, [L(a, 1, 1, 'cut')]))).toContain('คืนสินค้า/ไม่คืน');
  });
});
