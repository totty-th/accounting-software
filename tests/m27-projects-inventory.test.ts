import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';

const dir = new URL('../supabase/migrations/', import.meta.url);
let db: PGlite;
const one = async <T = any>(q: string, p: unknown[] = []) => (await db.query<any>(q, p)).rows[0] as T;
const err = async (p: Promise<unknown>) => { try { await p; return ''; } catch (e) { return (e as Error).message; } };

beforeAll(async () => { db = new PGlite(); for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(new URL(f, dir), 'utf8')); });
describe('M27.6 โปรเจ็ค', () => {
  it('สร้าง/ซ้ำชื่อ/สรุปรายได้-ค่าใช้จ่าย/แก้ชื่อตามเอกสาร/ลบไม่ได้เมื่อมีเอกสาร', async () => {
    const c = (await one<any>(`insert into contacts(contact_name) values ('ลูกค้า') returning id`)).id;
    const pid = (await one<any>(`select create_project('งาน A',$1) id`, [c])).id;
    expect(await err(db.query(`select create_project('งาน a')`))).toContain('มีโปรเจ็คชื่อ');
    await db.query(`insert into sales_docs(doc_type, doc_no, doc_date, contact_id, status, subtotal, vat, total, project) values ('INV','I1','2026-10-01',$1,'awaiting_payment',1000,70,1070,'งาน A'),('CN','C1','2026-10-02',$1,'approved',100,7,107,'งาน A')`, [c]);
    await db.query(`insert into expenses(exp_no, exp_date, contact_id, status, subtotal, vat, total, project) values ('E1','2026-10-03',$1,'approved',300,21,321,'งาน A'),('E2','2026-10-03',$1,'cancelled',999,0,999,'งาน A')`, [c]);
    const s = await one<any>(`select revenue::float8 r, expense::float8 e from project_summary() where id=$1`, [pid]);
    expect([s.r, s.e]).toEqual([900, 300]);
    expect(await err(db.query(`select delete_project($1)`, [pid]))).toContain('ลบไม่ได้');
    await db.query(`select update_project($1,'งาน B',$2)`, [pid, c]);
    expect((await one<any>(`select count(*)::int n from sales_docs where project='งาน B'`)).n).toBe(2);
  });
});
describe('M27.6 สรุปสินค้าคงเหลือ', () => {
  it('ย้อนตามวันที่/คลัง · ติดลบแสดง 0', async () => {
    const wh = (await one<any>(`select id from warehouses order by is_main desc limit 1`)).id;
    const p = (await one<any>(`insert into products(code,name,kind,base_unit) values ('T1','สินค้า','goods_stock','ชิ้น') returning id`)).id;
    await db.query(`select stock_in($1,$2,10,1000,'2026-10-01',  'RI', gen_random_uuid(), 'R1')`, [p, wh]);
    await db.query(`select stock_out($1,$2,4,'2026-10-10','INV', gen_random_uuid(),'I1')`, [p, wh]);
    const at = async (d: string) => await one<any>(`select qty::float8 q, avg_cost::float8 a, value::float8 v from inventory_summary($1::date,null) where code='T1'`, [d]);
    expect(await at('2026-10-05')).toEqual({ q: 10, a: 100, v: 1000 });
    expect(await at('2026-10-20')).toEqual({ q: 6, a: 100, v: 600 });
    await db.query(`select stock_out($1,$2,9,'2026-10-25','INV', gen_random_uuid(),'I2')`, [p, wh]);
    expect(await at('2026-10-30')).toEqual({ q: -3, a: 0, v: 0 });
    expect(await one<any>(`select count(*)::int n from inventory_summary('2026-09-01',null)`)).toEqual({ n: 0 });
  });
});
