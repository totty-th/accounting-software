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



const inv = async (lines: any[]) =>
  (await one<{ id: string }>(`select create_sales_doc('INV',$1::date,$2,$3::jsonb) as id`, [D, cust, JSON.stringify(lines)])).id;
const adj = async (type: 'CN' | 'DN', ref: string, lines: any[], reason: string | null = 'x') =>
  (await one<{ id: string }>(`select create_sales_doc($1,$2::date,$3,$4::jsonb,'exclusive',7,$5,$6) as id`,
    [type, D, cust, JSON.stringify(lines), ref, reason])).id;
const L = (p: string, qty: number, price: number, act?: string) =>
  ({ description: 'ตะแกรง', product_id: p, qty, unit_price: price, stock_action: act });

describe('M15.2 รีเซ็ต CN/DN · ประวัติ · โน้ต · ไฟล์ · WHT ของ DN', () => {
  beforeEach(async () => { await ri(50, 600, prod); });

  it('รีเซ็ต DN: ลงบัญชีใหม่ด้วยเลขใหม่ · สต็อกกลับมาตัด · ยกเลิกซ้ำได้', async () => {
    const i = await inv([L(prod, 10, 1000)]);
    const dn = await adj('DN', i, [L(prod, 2, 500, 'cut')], 'เพิ่ม');
    const v0 = (await sd(dn)).voucher_id;
    expect(await onHand()).toBe(38);
    await call('select cancel_sales_doc($1)', [dn]);
    expect(await onHand()).toBe(40);
    expect(await err(call('select restore_sales_doc($1)', [i]))).toContain('เฉพาะใบลดหนี้/ใบเพิ่มหนี้');
    await call('select restore_sales_doc($1)', [dn]);
    const d = await sd(dn);
    expect(d.status).toBe('active');
    expect(d.voucher_id).not.toBe(v0);
    expect(await entries(d.voucher_id)).toEqual([['11311', 1070, 0], ['41210', 0, 1000], ['27111', 0, 70]]);
    expect(await onHand()).toBe(38);
    expect(await err(call('select restore_sales_doc($1)', [dn]))).toContain('ยกเลิกแล้ว');
    await call('select cancel_sales_doc($1)', [dn]);   // ยกเลิกซ้ำได้
    expect(await onHand()).toBe(40);
  });

  it('รีเซ็ต CN: ลงบัญชีและสต็อกคืนใหม่ · ใบแจ้งหนี้ถูกยกเลิก/มีใบเสร็จ รีเซ็ตไม่ได้', async () => {
    const i = await inv([L(prod, 10, 1000)]);
    const cn = await adj('CN', i, [L(prod, 4, 1000, 'return')]);
    await call('select cancel_sales_doc($1)', [cn]);
    await call('select restore_sales_doc($1)', [cn]);
    const d = await sd(cn);
    expect(d.status).toBe('approved');
    expect(await entries(d.voucher_id)).toEqual([['41400', 4000, 0], ['27111', 280, 0], ['11311', 0, 4280]]);
    expect(await onHand()).toBe(44);
    await call('select cancel_sales_doc($1)', [cn]);
    await call('select create_receipt_from_invoice($1,$2::date)', [i, D]);
    expect(await err(call('select restore_sales_doc($1)', [cn]))).toContain('มีใบเสร็จ');
  });

  it('ประวัติเอกสารบันทึกสร้าง/เปลี่ยนสถานะ/โน้ต/ไฟล์ พร้อมผู้ทำ', async () => {
    const u = (await one<any>(`insert into app_users(username,display_name,role) values ('tester1','ทดสอบ','owner') on conflict (username) do update set display_name=excluded.display_name returning id`)).id;
    const i = await inv([L(prod, 1, 1000)]);
    const dn = await adj('DN', i, [L(prod, 1, 100, 'adjust')]);
    await call(`select set_config('app.user_id',$1,false)`, [u]);
    await call('select set_sales_doc_note($1,$2)', [dn, 'โน้ตภายใน']);
    const f = (await one<any>(`select add_sales_doc_file($1,'a.txt','text/plain',decode('68656c6c6f','hex')) id`, [dn])).id;
    await call('select remove_sales_doc_file($1)', [f]);
    await call('select cancel_sales_doc($1)', [dn]);
    const ev = (await db.query<any>('select event, detail, actor_id from doc_events where doc_id=$1 order by id', [dn])).rows;
    expect(ev.map(e => e.event)).toEqual(['created', 'note', 'file_added', 'file_removed', 'status']);
    expect(ev[4].detail).toBe('active>cancelled');
    expect(ev[1].actor_id).toBe(u);
    expect((await sd(dn)).internal_note).toBe('โน้ตภายใน');
    expect(await err(call(`select add_sales_doc_file($1,'a','x',''::bytea)`, [dn]))).toContain('ว่าง');
  });

  it('DN หัก ณ ที่จ่าย 3% ไหลเข้าใบเสร็จรวม · แก้หลังมีใบเสร็จไม่ได้', async () => {
    const i = await inv([L(prod, 1, 1000)]);
    const dn = await adj('DN', i, [L(prod, 1, 1000, 'adjust')]);
    expect(await err(call('select set_debit_note_wht($1,20)', [dn]))).toContain('ไม่ถูกต้อง');
    await call('select set_debit_note_wht($1,3)', [dn]);
    const r = (await one<any>('select create_combined_receipt($1::date,$2,$3) id', [D, cust, [i]])).id;
    const it = (await db.query<any>('select doc_id, amount, wht from receipt_items where receipt_id=$1', [r])).rows;
    expect(it.find((x: any) => x.doc_id === dn).wht).toBe('30.00');
    expect(await err(call('select set_debit_note_wht($1,1)', [dn]))).toContain('มีใบเสร็จ');
  });
});
