import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';

const dir = new URL('../supabase/migrations/', import.meta.url);
let db: PGlite; let prod: string, main: string, whB: string;
const D = '2026-10-27';
const one = async <T = any>(q: string, a: unknown[] = []) => (await db.query<any>(q, a)).rows[0] as T;
const err = async (p: Promise<unknown>) => { try { await p; return ''; } catch (e) { return (e as Error).message; } };
const sell = (q: number) => db.query(`select stock_out($1,$2,$3,$4::date,'INV',gen_random_uuid(),'INV-X')`, [prod, main, q, D]);

beforeAll(async () => { db = new PGlite(); for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(new URL(f, dir), 'utf8')); });
beforeEach(async () => {
  await db.exec(`truncate stock_adjustments, stock_alerts, stock_movements, product_stock, stock_transfer_lines, stock_transfers, product_units, products, doc_sequences cascade`);
  await db.exec(`delete from warehouses where not is_main; select set_stock_settings('warn', true)`);
  prod = (await one<any>(`insert into products(code,name,kind,purchase_price,sale_price) values ('T-P20-15','ตะแกรงรู P20','goods_stock',1400,1850) returning id`)).id;
  main = (await one<any>('select main_warehouse() id')).id;
  await db.query('select set_opening_stock($1,$2::date,10,1380)', [prod, D]);
});

describe('M26.2 ขายติดลบ 3 ระดับ', () => {
  it('allow/warn: ขายเกินได้ (ติดลบ + แจ้งเตือน) · block: ขายเกินไม่ได้', async () => {
    await sell(12);
    expect(+(await one<any>('select stock_on_hand($1) v', [prod])).v).toBe(-2);
    await db.query("select set_stock_settings('allow', true)"); await sell(1);
    await db.query("select set_stock_settings('block', true)");
    expect(await err(sell(5))).toContain('สต็อกไม่พอ');
    await db.exec("delete from stock_movements where doc_no='INV-X'; update product_stock set qty=10, value=13800");
    await sell(10);                                                    // พอดีคงเหลือ → ผ่าน
  });
  it('block ระดับบริษัทไม่ครอบคลุมปรับยอด (ใช้กฎของสินค้า)', async () => {
    await db.query("select set_stock_settings('block', true)");
    await db.query(`select adjust_stock($1::date,$2,$3,'out','สินค้าสูญหาย',15)`, [D, prod, main]);
    expect(+(await one<any>('select stock_on_hand($1) v', [prod])).v).toBe(-5);
  });
  it('ค่าไม่ถูกต้องถูกปฏิเสธ', async () => { expect(await err(db.query("select set_stock_settings('x', true)"))).toContain('ไม่ถูกต้อง'); });
  it('ปิดสวิตช์สินค้าใกล้หมด → ไม่มีรายการ', async () => {
    await db.query('update warehouses set low_stock_min = 20 where id=$1', [main]);
    expect((await db.query('select * from low_stock_items()')).rows.length).toBe(1);
    await db.query("select set_stock_settings('warn', false)");
    expect((await db.query('select * from low_stock_items()')).rows.length).toBe(0);
  });
});

describe('M26.2 แก้/ลบสินค้า', () => {
  it('แก้ข้อมูลและหน่วยอื่น (แทนที่ทั้งชุด)', async () => {
    await db.query(`select update_product($1, $2::jsonb)`, [prod, JSON.stringify({ name: 'ตะแกรงใหม่', category: 'เหล็ก', sale_price: 2000, units: [{ unit: 'มัด', factor: 10, sale_price: 19000 }] })]);
    const p = await one<any>('select * from products where id=$1', [prod]);
    expect([p.name, p.category, +p.sale_price, p.code]).toEqual(['ตะแกรงใหม่', 'เหล็ก', 2000, 'T-P20-15']);
    expect((await db.query('select * from product_units where product_id=$1', [prod])).rows.length).toBe(1);
    await db.query(`select update_product($1, $2::jsonb)`, [prod, JSON.stringify({ name: 'x', units: [] })]);
    expect((await db.query('select * from product_units where product_id=$1', [prod])).rows.length).toBe(0);
  });
  it('เปลี่ยนชนิดสินค้าไม่ได้เมื่อมีสต็อกเคลื่อนไหว', async () => {
    expect(await err(db.query(`select update_product($1, $2::jsonb)`, [prod, JSON.stringify({ name: 'x', kind: 'service' })]))).toContain('เปลี่ยนชนิด');
  });
  it('ลบสินค้าที่เคยใช้ไม่ได้ · ที่ยังไม่เคยใช้ลบได้ · ปิดใช้งานได้', async () => {
    expect(await err(db.query('select delete_product($1)', [prod]))).toContain('ลบไม่ได้');
    expect(+(await one<any>('select count(*) c from products where id=$1', [prod])).c).toBe(1);
    await db.query('select set_product_active($1,false)', [prod]);
    expect((await one<any>('select is_active a from products where id=$1', [prod])).a).toBe(false);
    const n = (await one<any>(`insert into products(code,name,kind) values ('NEW','ใหม่','service') returning id`)).id;
    await db.query('select delete_product($1)', [n]);
    expect(+(await one<any>('select count(*) c from products where id=$1', [n])).c).toBe(0);
  });
});

describe('M26.2 ลบคลัง', () => {
  it('คลังหลัก/มีคงเหลือ/มีประวัติ ลบไม่ได้ · คลังว่างลบได้', async () => {
    expect(await err(db.query('select delete_warehouse($1)', [main]))).toContain('คลังหลัก');
    whB = (await one<any>(`select create_warehouse('B','B','storage') id`)).id;
    await db.query(`select adjust_stock($1::date,$2,$3,'in','อื่น ๆ',5,1400)`, [D, prod, whB]);
    expect(await err(db.query('select delete_warehouse($1)', [whB]))).toContain('คงเหลือ');
    await db.query(`select adjust_stock($1::date,$2,$3,'out','อื่น ๆ',5)`, [D, prod, whB]);
    expect(await err(db.query('select delete_warehouse($1)', [whB]))).toContain('ประวัติ');
    const c = (await one<any>(`select create_warehouse('C','C','storage') id`)).id;
    await db.query('select delete_warehouse($1)', [c]);
    expect(+(await one<any>('select count(*) n from warehouses where id=$1', [c])).n).toBe(0);
  });
});
