import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';

const dir = new URL('../supabase/migrations/', import.meta.url);
let db: PGlite; let main: string, whB: string;
const one = async <T = any>(q: string, a: unknown[] = []) => (await db.query<any>(q, a)).rows[0] as T;
const err = async (p: Promise<unknown>) => { try { await p; return ''; } catch (e) { return (e as Error).message; } };
const run = async (items: unknown[], wh: string | null = null) => (await one<any>('select import_products($1,$2,$3::jsonb) id', ['a.xlsx', wh, JSON.stringify(items)])).id as string;

beforeAll(async () => { db = new PGlite(); for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(new URL(f, dir), 'utf8')); });
beforeEach(async () => {
  await db.exec(`truncate stock_movements, product_stock, product_units, product_low_stock, product_import_batches, products, doc_sequences cascade; delete from warehouses where not is_main; update warehouses set low_stock_min = null;`);
  main = (await one<any>('select main_warehouse() id')).id; whB = (await one<any>(`select create_warehouse('B','B','storage') id`)).id;
});

describe('M26.3 นำเข้าสินค้า (ฐานข้อมูล)', () => {
  it('นำเข้าครบ 3 ประเภท + หน่วยอื่น + ยอดตั้งต้นเข้าคลังที่เลือก', async () => {
    const b = await run([{ kind: 'service', code: 'SV', name: 'ขนส่ง', sale: 500 },
      { kind: 'goods_stock', code: 'S1', name: 'ตะแกรง', unit: 'แผ่น', sale: 1850, buy: 1400, units: [{ unit: 'มัด', factor: 10, sale: 18000, buy: 13500 }], open: { qty: 50, cost: 1380, date: '2026-10-27' } }], whB);
    expect(+(await one<any>('select count(*) c from products where import_batch=$1', [b])).c).toBe(2);
    expect(+(await one<any>(`select stock_on_hand(id,$1) v from products where code='S1'`, [whB])).v).toBe(50);
    expect(+(await one<any>(`select stock_on_hand(id,$1) v from products where code='S1'`, [main])).v).toBe(0);
    expect((await db.query('select * from product_units')).rows.length).toBe(1);
    expect(+(await one<any>(`select value::float8 v from product_stock`)).v).toBe(69000);
  });
  it('ผิดแถวเดียว = ไม่เข้าสักรายการ (รหัสซ้ำในระบบ)', async () => {
    await db.query(`insert into products(code,name,kind) values ('DUP','เดิม','service')`);
    const m = await err(run([{ kind: 'service', code: 'OK', name: 'ก' }, { kind: 'service', code: 'DUP', name: 'ข' }]));
    expect(m).toContain('duplicate'); expect(+(await one<any>(`select count(*) c from products where code='OK'`)).c).toBe(0);
    expect(+(await one<any>('select count(*) c from product_import_batches')).c).toBe(0);
  });
  it('ลบทั้งชุด: ลบที่ยังไม่เคลื่อนไหว (รวมยอดตั้งต้นที่นำเข้า) เก็บที่มีเคลื่อนไหวแล้ว', async () => {
    const b = await run([{ kind: 'goods_stock', code: 'A', name: 'A', unit: 'ชิ้น', open: { qty: 5, cost: 10, date: '2026-10-27' } }, { kind: 'goods_stock', code: 'B', name: 'B', unit: 'ชิ้น', open: { qty: 5, cost: 10, date: '2026-10-27' } }]);
    const bid = (await one<any>(`select id from products where code='B'`)).id;
    await db.query(`select adjust_stock('2026-10-27'::date,$1,$2,'out','อื่น ๆ',1)`, [bid, main]);
    const r = (await one<any>('select delete_import_batch($1) r', [b])).r;
    expect(r).toEqual({ deleted: 1, kept: 1 });
    expect(+(await one<any>(`select count(*) c from products where code='A'`)).c).toBe(0);
    expect(await err(db.query('select delete_import_batch($1)', [b]))).toContain('ถูกลบไปแล้ว');
  });
  it('ใกล้หมดกำหนดเองรายสินค้า แทนค่าขั้นต่ำของคลัง', async () => {
    await run([{ kind: 'goods_stock', code: 'A', name: 'A', unit: 'ชิ้น', open: { qty: 8, cost: 10, date: '2026-10-27' } }]);
    const id = (await one<any>(`select id from products where code='A'`)).id;
    await db.query('update warehouses set low_stock_min = 5 where id=$1', [main]);
    expect((await db.query('select * from low_stock_items()')).rows.length).toBe(0);       // 8 > 5
    await db.query(`select set_product_low_stock($1,'custom',$2::jsonb)`, [id, JSON.stringify([{ warehouse_id: main, min_qty: 10 }])]);
    expect((await db.query('select * from low_stock_items()')).rows.length).toBe(1);       // 8 ≤ 10
    await db.query(`select set_product_low_stock($1,'default','[]')`, [id]);
    expect((await db.query('select * from low_stock_items()')).rows.length).toBe(0);
  });
  it('update_product เก็บรายละเอียด/VAT/ประเภท', async () => {
    await run([{ kind: 'goods_nostock', code: 'N', name: 'N', unit: 'ชิ้น' }]);
    const id = (await one<any>(`select id from products where code='N'`)).id;
    await db.query('select update_product($1,$2::jsonb)', [id, JSON.stringify({ name: 'N2', description: 'รายละเอียด', sale_vat_mode: 'inclusive', purchase_vat_mode: 'zero', goods_type: 'other' })]);
    const p = await one<any>('select * from products where id=$1', [id]);
    expect([p.description, p.sale_vat_mode, p.purchase_vat_mode, p.goods_type]).toEqual(['รายละเอียด', 'inclusive', 'zero', 'other']);
  });
});
