import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';

const dir = new URL('../supabase/migrations/', import.meta.url);
let db: PGlite; let prod: string, main: string, whB: string;
const D = '2026-10-26';
const one = async <T = any>(q: string, a: unknown[] = []) => (await db.query<any>(q, a)).rows[0] as T;
const err = async (p: Promise<unknown>) => { try { await p; return ''; } catch (e) { return (e as Error).message; } };
const oh = async (w: string | null = null) => +(await one<any>('select stock_on_hand($1,$2) v', [prod, w])).v;
const ps = () => one<any>('select qty::float8 q, value::float8 v from product_stock where product_id=$1', [prod]);
const nV = async () => +(await one<any>('select count(*) c from journal_vouchers')).c;

beforeAll(async () => { db = new PGlite(); for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(new URL(f, dir), 'utf8')); });
beforeEach(async () => {
  await db.exec(`truncate stock_adjustments, stock_alerts, stock_movements, product_stock, stock_transfer_lines, stock_transfers, product_units, products, doc_sequences cascade`);
  await db.exec('delete from warehouses where not is_main; update warehouses set low_stock_min = null');
  prod = (await one<any>(`insert into products(code,name,kind,purchase_price,sale_price) values ('T-P20-15','ตะแกรงรู P20','goods_stock',1400,1850) returning id`)).id;
  main = (await one<any>('select main_warehouse() id')).id;
  whB = (await one<any>(`select create_warehouse('B','TEST Warehouse B','storage') id`)).id;
});

describe('M26 โมดูลสินค้า (ตาม FA 26-10-2026)', () => {
  it('ยอดตั้งต้น 50@1,380 → คงเหลือ 50 มูลค่า 69,000 ไม่ลงบัญชี', async () => {
    const v0 = await nV();
    await db.query('select set_opening_stock($1,$2::date,50,1380)', [prod, D]);
    expect(await ps()).toEqual({ q: 50, v: 69000 });
    expect(await oh(main)).toBe(50);
    expect(await nV()).toBe(v0);
  });
  it('ปรับลด 2 แผ่น: ADJ เลขรายวัน · คงเหลือ 48 · ต้นทุนตามเฉลี่ย 1,380 · ไม่ลงบัญชี · ลบรายการแล้วกลับ 50', async () => {
    await db.query('select set_opening_stock($1,$2::date,50,1380)', [prod, D]);
    const v0 = await nV();
    const id = (await one<any>(`select adjust_stock($1::date,$2,$3,'out','สินค้าชำรุด/เสื่อมสภาพ',2) id`, [D, prod, main])).id;
    const a = await one<any>('select adj_no, unit_cost::float8 c from stock_adjustments where id=$1', [id]);
    expect(a.adj_no).toBe('ADJ202610260001'); expect(a.c).toBe(1380);
    expect(await ps()).toEqual({ q: 48, v: 66240 });
    expect(await nV()).toBe(v0);
    await db.query('select delete_stock_adjustment($1)', [id]);
    expect(await ps()).toEqual({ q: 50, v: 69000 });
    expect(await oh(main)).toBe(50);
    expect(await err(db.query('select delete_stock_adjustment($1)', [id]))).toMatch(/ไม่พบรายการปรับยอด/);
  });
  it('ปรับเพิ่มระบุต้นทุน → ต้นทุนเฉลี่ยเคลื่อนที่ · ปรับลดเกินคงเหลือได้ถ้าไม่ห้ามติดลบ แต่ห้ามเมื่อตั้ง block_negative', async () => {
    await db.query('select set_opening_stock($1,$2::date,10,1000)', [prod, D]);
    await db.query(`select adjust_stock($1::date,$2,$3,'in','นับพบเกิน',10,2000)`, [D, prod, main]);
    expect(await ps()).toEqual({ q: 20, v: 30000 });
    await db.query(`select adjust_stock($1::date,$2,$3,'out','สูญหาย',25)`, [D, prod, main]);
    expect(await oh()).toBe(-5);
    await db.query('update products set block_negative=true where id=$1', [prod]);
    expect(await err(db.query(`select adjust_stock($1::date,$2,$3,'out','สูญหาย',1)`, [D, prod, main]))).toMatch(/สต็อกไม่พอ/);
    expect(await err(db.query(`select adjust_stock($1::date,$2,$3,'out','',1)`, [D, prod, main]))).toMatch(/สาเหตุ/);
  });
  it('โอน: ใช้ราคาซื้อ 1,400 ต่อหน่วย · รับแล้วคลังหลัก −/คลัง B + รวมเท่าเดิม · รีเซ็ตกลับรอดำเนินการและความเคลื่อนไหวหาย · ไม่ลงบัญชี', async () => {
    await db.query('select set_opening_stock($1,$2::date,50,1380)', [prod, D]);
    const v0 = await nV();
    const id = (await one<any>(`select create_transfer($1::date,$2,$3,$4::jsonb) id`, [D, main, whB, JSON.stringify([{ product_id: prod, qty: 60 }])])).id;
    expect(+(await one<any>('select unit_cost c from stock_transfer_lines where tf_id=$1', [id])).c).toBe(1400);
    await db.query('select receive_transfer($1)', [id]);
    expect([await oh(main), await oh(whB), await oh()]).toEqual([-10, 60, 50]);
    expect((await one<any>('select tf_no from stock_transfers where id=$1', [id])).tf_no).toBe('TF202610260001');
    await db.query('select reset_transfer($1)', [id]);
    expect([await oh(main), await oh(whB)]).toEqual([50, 0]);
    expect((await one<any>('select status from stock_transfers where id=$1', [id])).status).toBe('pending');
    expect(await err(db.query('select reset_transfer($1)', [id]))).toMatch(/รีเซ็ตได้เฉพาะ/);
    await db.query('select receive_transfer($1)', [id]);   // รับซ้ำได้หลังรีเซ็ต
    expect(await oh(whB)).toBe(60);
    expect(await nV()).toBe(v0);
  });
  it('โอนเกินคงเหลือถูกกันเมื่อสินค้าห้ามติดลบ', async () => {
    await db.query('select set_opening_stock($1,$2::date,50,1380)', [prod, D]);
    await db.query('update products set block_negative=true where id=$1', [prod]);
    const id = (await one<any>(`select create_transfer($1::date,$2,$3,$4::jsonb) id`, [D, main, whB, JSON.stringify([{ product_id: prod, qty: 60 }])])).id;
    expect(await err(db.query('select receive_transfer($1)', [id]))).toMatch(/สต็อกต้นทางไม่พอ/);
  });
  it('คลัง: แก้ไข/ตั้งเป็นคลังหลัก · สินค้าใกล้หมดตามขั้นต่ำต่อคลัง (ติดลบก็นับ)', async () => {
    await db.query(`select update_warehouse($1,'คลัง B','WB','branch','ที่อยู่','10110','สมชาย','a@b.c','0812345678')`, [whB]);
    expect((await one<any>('select postal_code p, contact_name n from warehouses where id=$1', [whB]))).toEqual({ p: '10110', n: 'สมชาย' });
    await db.query('select set_opening_stock($1,$2::date,10,1000)', [prod, D]);
    expect((await db.query('select * from low_stock_items()')).rows).toHaveLength(0);   // ยังไม่ตั้งขั้นต่ำ
    await db.query('update warehouses set low_stock_min=20 where id=$1', [main]);
    const r = (await db.query<any>('select code, on_hand::float8 q, min_qty::float8 m from low_stock_items()')).rows;
    expect(r).toEqual([{ code: 'T-P20-15', q: 10, m: 20 }]);
    await db.query('select adjust_stock($1::date,$2,$3,$4,$5,$6)', [D, prod, main, 'out', 'สูญหาย', 25]);
    expect((await db.query<any>('select on_hand::float8 q from low_stock_items($1)', [main])).rows[0].q).toBe(-15);
    await db.query('select set_main_warehouse($1)', [whB]);
    expect((await one<any>('select id from warehouses where is_main')).id).toBe(whB);
  });
  it('หลายหน่วย: เก็บอัตราแปลง 1 มัด = 10 แผ่น', async () => {
    await db.query(`insert into product_units(product_id,unit,factor,sale_price,purchase_price) values ($1,'มัด',10,17500,13500)`, [prod]);
    expect(+(await one<any>(`select factor f from product_units where product_id=$1 and unit='มัด'`, [prod])).f).toBe(10);
    expect(await err(db.query(`insert into product_units(product_id,unit,factor) values ($1,'x',0)`, [prod]))).toMatch(/check|violates/);
  });
});
