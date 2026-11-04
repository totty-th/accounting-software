import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { COA } from '../web/lib/seed';

// ใบลดหนี้หลายใบต่อใบแจ้งหนี้ (ตามต้นแบบ FA) + คุมยอด/จำนวนคืนสะสม
const dir = new URL('../supabase/migrations/', import.meta.url);
let db: PGlite;
const one = async <T = any>(q: string, a: unknown[] = []) => (await db.query<any>(q, a)).rows[0] as T;
const J = JSON.stringify;
const err = async (p: Promise<unknown>) => { try { await p; return ''; } catch (e) { return (e as Error).message; } };
const onHand = async (p: string) => +(await one<any>('select stock_on_hand($1,null) v', [p])).v;
let cu = '', prod = '', inv = '';

beforeAll(async () => {
  db = new PGlite();
  for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(new URL(f, dir), 'utf8'));
  for (const [c, n, t] of COA) await db.query('insert into accounts(code,name,type) values ($1,$2,$3) on conflict (code) do update set name=excluded.name,type=excluded.type', [c, n, t]);
  cu = (await one<any>(`insert into contacts(business_name,tax_id) values ('ลูกค้า ก','0105511111111') returning id`)).id;
  prod = (await one<any>(`insert into products(code,name,kind,sale_price,purchase_price,base_unit) values ('G1','ตะแกรง','goods_stock',100,50,'แผ่น') returning id`)).id;
  await db.query(`select set_opening_stock($1,$2,100,50)`, [prod, (await one<any>('select main_warehouse() id')).id]).catch(() => {});
  inv = (await one<any>(`select create_sales_doc('INV','2026-10-01',$1,$2::jsonb,'exclusive',7) id`, [cu, J([{ description: 'ตะแกรง', qty: 10, unit_price: 100, product_id: prod }])])).id;
});
const cn = (qty: number, act = 'return', price = 100) => db.query(
  `select create_sales_doc('CN','2026-10-05',$3,$1::jsonb,'exclusive',7,$2,'คืนสินค้า') id`,
  [J([{ description: 'ตะแกรง', qty, unit_price: price, product_id: prod, stock_action: act }]), inv, cu]);

describe('multi CN per INV', () => {
  it('ออกได้หลายใบ คืนสต็อกสะสม', async () => {
    const b = await onHand(prod);
    const a = (await cn(3)).rows[0].id; const c = (await cn(2)).rows[0].id;
    expect(a).not.toBe(c);
    expect(await onHand(prod)).toBe(b + 5);
  });
  it('จำนวนคืนสะสมเกินใบแจ้งหนี้ไม่ได้', async () => {
    expect(await err(cn(6))).toContain('จำนวนที่ลดเกิน');
  });
  it('ยอดรวมสะสมเกินไม่ได้ (no_return)', async () => {
    expect(await err(cn(1, 'no_return', 600))).toContain('เกินยอดใบแจ้งหนี้');
  });
  it('ยกเลิกใบหนึ่ง แล้วออกใหม่ในโควตาที่คืนมา', async () => {
    const id = (await one<any>(`select id from sales_docs where doc_type='CN' and ref_doc_id=$1 order by doc_no limit 1`, [inv])).id;
    await db.query('select cancel_sales_doc($1)', [id]);
    expect((await cn(3)).rows[0].id).toBeTruthy();
  });
  it('ยอดค้างชำระของ INV = ยอดเต็ม − CN รวม', async () => {
    const t = await one<any>(`select (select total from sales_docs where id=$1) - coalesce((select sum(total) from sales_docs where ref_doc_id=$1 and doc_type='CN' and status<>'cancelled'),0) due`, [inv]);
    expect(+t.due).toBeCloseTo(10 * 100 * 1.07 - 5 * 100 * 1.07, 2);
  });
});
