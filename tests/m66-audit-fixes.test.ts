// M66 แก้บั๊กจากรายงานตรวจประเมิน (B-03, B-05, B-07, B-12, B-13, B-14) — สถานการณ์เดียวกับสคริปต์ตรวจ audit/edge.mjs
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';

const dir = new URL('../supabase/migrations/', import.meta.url);
let db: PGlite; let cust: string, vend: string, WH: string;
const ACCOUNTS: [string, string, string][] = [
  ['11112', 'เงินสด', 'asset'], ['11311', 'ลูกหนี้', 'asset'], ['17113', 'ภาษีซื้อยังไม่ถึงกำหนด', 'asset'], ['21311', 'เจ้าหนี้', 'liability'],
  ['27111', 'ภาษีขาย', 'liability'], ['41110', 'รายได้ขาย', 'revenue'], ['51111.01', 'ซื้อสินค้า', 'expense'], ['53102', 'ค่าเช่า', 'expense'],
];
const err = async (p: Promise<unknown>) => { try { await p; return ''; } catch (e) { return (e as Error).message; } };
const one = async <T = any>(q: string, a: unknown[] = []) => (await db.query<any>(q, a)).rows[0] as T;
const J = JSON.stringify;
const prod = async (code: string) => (await one(`insert into products(code,name,kind,base_unit) values ($1,$1,'goods_stock','แผ่น') returning id`, [code])).id as string;
const ri = (date: string, p: string, qty: number, price: number) => one(`select save_goods_receipt($1::jsonb,$2::jsonb) id`, [J({ date, contact: vend }), J([{ product_id: p, qty, unit_price: price }])]);
const inv = async (date: string, lines: object[]) => (await one(`select create_invoice_full($1::jsonb,$2::jsonb) id`, [J({ date, contact: cust }), J(lines)])).id as string;
const adj = (date: string, p: string, dir: string, qty: number, cost: number | null = null) =>
  one(`select adjust_stock($1::date,$2,$3,$4,'ทดสอบ',$5,$6) id`, [date, p, WH, dir, qty, cost]);
const st = (p: string) => one<any>(`select qty::float8 q, value::float8 v from product_stock where product_id=$1`, [p]);
const mv = (doc: string) => one<any>(`select unit_cost::float8 c, value::float8 v from stock_movements where doc_id=$1 and voided_at is null`, [doc]);

beforeAll(async () => {
  db = new PGlite();
  for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(new URL(f, dir), 'utf8'));
});
beforeEach(async () => {
  await db.exec(`truncate stock_alerts, stock_movements, product_stock, stock_adjustments, product_units, goods_receipt_lines, goods_receipts, products,
    receipt_items, receipts, billing_note_items, sales_doc_lines, sales_docs, contacts, journal_lines, journal_vouchers, period_locks, doc_sequences, accounts cascade`);
  await db.query(`update stock_settings set negative_sales='warn'`);
  for (const [c, n, t] of ACCOUNTS) await db.query('insert into accounts(code,name,type) values ($1,$2,$3)', [c, n, t]);
  cust = (await one(`insert into contacts(business_name) values ('ลูกค้า') returning id`)).id;
  vend = (await one(`insert into contacts(business_name) values ('ผู้ขาย') returning id`)).id;
  WH = (await one('select main_warehouse() id')).id;
});

describe('M66 แก้บั๊กจากการตรวจประเมิน', () => {
  it('B-03 ปรับยอด/ตั้งยอดตั้งต้น/ยกเลิกปรับยอด ในงวดที่ล็อก ทำไม่ได้ · สต็อกงวดที่ปิดไม่เปลี่ยน', async () => {
    const p = await prod('L1'); await ri('2026-05-01', p, 10, 100);
    const a = (await adj('2026-05-10', p, 'out', 2)).id;
    await db.query(`select lock_period('2026-04-01','2026-06-30','ปิดงวด')`);
    expect(await err(adj('2026-05-15', p, 'out', 1))).toMatch(/PERIOD_LOCKED/);
    expect(await err(db.query(`select set_opening_stock($1,'2026-05-15'::date,5,100)`, [p]))).toMatch(/PERIOD_LOCKED/);
    expect(await err(db.query(`select delete_stock_adjustment($1)`, [a]))).toMatch(/PERIOD_LOCKED/);
    expect(await one(`select qty::float8 q, value::float8 v from inventory_summary('2026-06-30') where code='L1'`)).toEqual({ q: 8, v: 800 });
    await adj('2026-07-01', p, 'out', 1);   // งวดที่ไม่ล็อก ทำได้ตามปกติ
    expect((await st(p)).q).toBe(7);
  });

  it('B-05 ปรับเข้าด้วยต้นทุนติดลบไม่ได้', async () => {
    const p = await prod('N1');
    expect(await err(adj('2026-06-08', p, 'in', 1, -500))).toMatch(/ไม่ติดลบ/);
    expect(await err(db.query(`select stock_in($1,$2,1,-5,'2026-06-08'::date,'ADJ',gen_random_uuid(),'x')`, [p, WH]))).toMatch(/ไม่ติดลบ/);
  });

  it('B-07 รับซื้อย้อนหลังก่อนวันขาย → ต้นทุนขายและคงเหลือคิดใหม่ตามวันที่', async () => {
    const p = await prod('B7');
    await ri('2026-06-01', p, 10, 100);
    const s = await inv('2026-06-10', [{ product_id: p, description: 'x', qty: 10, unit_price: 300 }]);
    expect(await mv(s)).toEqual({ c: 100, v: 1000 });
    await ri('2026-06-05', p, 10, 200);   // ย้อนหลังก่อนขาย: เฉลี่ย ณ 10-06 = 150
    expect(await mv(s)).toEqual({ c: 150, v: 1500 });
    expect(await st(p)).toEqual({ q: 10, v: 1500 });
    expect(await one(`select qty::float8 q, value::float8 v from inventory_summary('2026-06-30') where code='B7'`)).toEqual({ q: 10, v: 1500 });
    // ยกเลิกใบรับย้อนหลัง → กลับเป็นต้นทุนเดิม
    const r2 = (await one(`select id from goods_receipts where ri_date='2026-06-05'`)).id;
    await db.query(`select cancel_goods_receipt($1)`, [r2]);
    expect(await mv(s)).toEqual({ c: 100, v: 1000 });
    expect(await st(p)).toEqual({ q: 0, v: 0 });
  });

  it('B-07 รับย้อนหลังที่กระทบต้นทุนในงวดที่ล็อกไม่ได้', async () => {
    const p = await prod('B7L');
    await ri('2026-05-01', p, 10, 100);
    await inv('2026-05-10', [{ product_id: p, description: 'x', qty: 5, unit_price: 300 }]);
    await db.query(`select lock_period('2026-05-05','2026-05-31','ปิดงวด')`);
    expect(await err(ri('2026-05-02', p, 10, 200))).toMatch(/PERIOD_LOCKED/);
  });

  it('B-07 ปรับเข้าไม่ใส่ต้นทุนใช้ต้นทุนเฉลี่ย ณ วันที่นั้นหลังคำนวณใหม่', async () => {
    const p = await prod('B7A');
    await ri('2026-06-01', p, 10, 100);
    const a = (await adj('2026-06-10', p, 'in', 10)).id;    // ตอนบันทึก เฉลี่ย 100
    expect(await mv(a)).toEqual({ c: 100, v: 1000 });
    await ri('2026-06-05', p, 10, 400);                      // ย้อนหลัง → เฉลี่ย ณ 10-06 = 250
    expect(await mv(a)).toEqual({ c: 250, v: 2500 });
    expect(await st(p)).toEqual({ q: 30, v: 7500 });
  });

  it('B-12 ขายเป็นหน่วยรอง (1 มัด = 10 แผ่น) ตัดสต็อก 20 แผ่น', async () => {
    const p = await prod('U1'); await db.query(`insert into product_units(product_id,unit,factor) values ($1,'มัด',10)`, [p]);
    await ri('2026-06-01', p, 100, 10);
    await inv('2026-06-19', [{ product_id: p, description: 'x', qty: 2, unit: 'มัด', unit_price: 900 }]);
    expect((await st(p)).q).toBe(80);
    await inv('2026-06-19', [{ product_id: p, description: 'x', qty: 3, unit_price: 90 }]);   // หน่วยหลักตามปกติ
    expect((await st(p)).q).toBe(77);
  });

  it('B-13 แก้/ลบการเคลื่อนไหวสต็อกตรง ๆ ไม่ได้ (ยกเว้นยอดตั้งต้นที่ยังไม่เคลื่อนไหว)', async () => {
    const p = await prod('D1'); await ri('2026-06-01', p, 10, 100);
    expect(await err(db.query(`delete from stock_movements where product_id=$1`, [p]))).toMatch(/ลบการเคลื่อนไหวสต็อกไม่ได้/);
    expect(await err(db.query(`update stock_movements set qty_in=99 where product_id=$1`, [p]))).toMatch(/แก้ไขการเคลื่อนไหวสต็อกไม่ได้/);
    const q = await prod('D2'); await db.query(`select set_opening_stock($1,'2026-06-01'::date,5,10)`, [q]);
    await db.query(`delete from stock_movements where product_id=$1 and doc_type='OPEN'`, [q]);
    expect((await one(`select count(*)::int n from stock_movements where product_id=$1`, [q])).n).toBe(0);
  });

  it('B-14 ปลดล็อกงวดบันทึกผู้ปลดและเหตุผล', async () => {
    const u = '00000000-0000-0000-0000-000000000001';
    const l = (await one(`select lock_period('2026-04-01','2026-04-30','ปิด') id from (select set_config('app.user_id',$1,false)) s`, [u])).id;
    await db.query(`select release_period_lock($1,'แก้ใบกำกับผิด')`, [l]);
    const r = await one(`select created_by, released_by, release_reason, released_at is not null rel from period_locks where id=$1`, [l]);
    expect(r).toEqual({ created_by: u, released_by: u, release_reason: 'แก้ใบกำกับผิด', rel: true });
    expect(await err(db.query(`select release_period_lock($1)`, [l]))).toMatch(/ไม่พบ/);
    await db.query(`select set_config('app.user_id','',false)`);
  });

  it('ทุกตารางเปิด RLS', async () => {
    expect((await one(`select count(*)::int n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity`)).n).toBe(0);
  });
});
