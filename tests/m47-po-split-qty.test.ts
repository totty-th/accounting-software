import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { COA } from '../web/lib/seed';

// PO แบ่งรับตามจำนวนสินค้า (ตามต้นแบบ FA): สต็อกเข้าตามจำนวนที่แบ่ง ณ ตอนบันทึก RI
const dir = new URL('../supabase/migrations/', import.meta.url);
let db: PGlite;
const one = async <T = any>(q: string, a: unknown[] = []) => (await db.query<any>(q, a)).rows[0] as T;
const J = JSON.stringify;
const err = async (p: Promise<unknown>) => { try { await p; return ''; } catch (e) { return (e as Error).message; } };
const onHand = async (p: string) => +(await one<any>('select stock_on_hand($1,null) v', [p])).v;
const poSt = async (id: string) => (await one<any>('select status from purchase_orders where id=$1', [id])).status;
let sup = '', a = '', b = '', po = '';
const split = async (q: unknown[]) => (await one<any>('select split_ri_from_po_qty($1,$2::date,$3::jsonb) id', [po, '2026-10-10', J(q)])).id;

beforeAll(async () => {
  db = new PGlite();
  for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(new URL(f, dir), 'utf8'));
  for (const [c, n, t] of COA) await db.query('insert into accounts(code,name,type) values ($1,$2,$3) on conflict (code) do update set name=excluded.name,type=excluded.type', [c, n, t]);
  sup = (await one<any>(`insert into contacts(business_name,tax_id) values ('ซัพพลายเออร์','0105522222222') returning id`)).id;
  const mk = async (c: string, buy: number) => (await one<any>(`insert into products(code,name,kind,sale_price,purchase_price,base_unit) values ($1,$1,'goods_stock',0,$2,'แผ่น') returning id`, [c, buy])).id;
  a = await mk('RM-A', 1000); b = await mk('RM-B', 500);
  po = (await one<any>('select save_purchase_order(null,$1::jsonb,$2::jsonb) id', [J({ date: '2026-10-01', contact: sup, credit_days: 30 }),
    J([{ product_id: a, qty: 100, unit_price: 1000 }, { product_id: b, qty: 30, unit_price: 500 }])])).id;
  await db.query('select approve_purchase_order($1)', [po]);
});

describe('PO แบ่งตามจำนวน', () => {
  it('งวด 1: A 40 → สต็อกเข้า 40 ทันที, PO = partial', async () => {
    await split([{ line_no: 1, qty: 40 }]);
    expect(await onHand(a)).toBe(40); expect(await onHand(b)).toBe(0);
    expect(await poSt(po)).toBe('partial');
    expect(+(await one<any>('select total from goods_receipts where po_id=$1', [po])).total).toBe(42800);
  });
  it('เกินจำนวนคงเหลือไม่ได้ / ไม่ระบุจำนวนไม่ได้ / ปนโหมดไม่ได้', async () => {
    expect(await err(split([{ line_no: 1, qty: 61 }]))).toContain('เกินจำนวนคงเหลือ');
    expect(await err(split([]))).toContain('อย่างน้อย 1 บรรทัด');
    expect(await err(db.query(`select split_ri_from_po($1,'2026-10-10'::date,'percent',10)`, [po]))).not.toBe('');
    expect(await onHand(a)).toBe(40);   // ไม่มีผลค้างจากครั้งที่ error (rollback)
  });
  it('งวด 2: A 60 + B 10 → ผลรวมถูก, ยังเป็น partial', async () => {
    await split([{ line_no: 1, qty: 60 }, { line_no: 2, qty: 10 }]);
    expect(await onHand(a)).toBe(100); expect(await onHand(b)).toBe(10);
    expect(await poSt(po)).toBe('partial');
  });
  it('ยกเลิก RI งวด 2 → คืนสต็อก, จำนวนกลับมาคงเหลือ, PO ยังเป็น partial', async () => {
    const id = (await one<any>(`select id from goods_receipts where po_id=$1 order by ri_no desc limit 1`, [po])).id;
    await db.query('select cancel_goods_receipt($1)', [id]);
    expect(await onHand(a)).toBe(40); expect(await onHand(b)).toBe(0);
    expect(await poSt(po)).toBe('partial');
  });
  it('รับครบ → converted, ยอดรวมตรง PO (ไม่มีเศษปัด) และบัญชีตรง', async () => {
    await split([{ line_no: 1, qty: 33 }, { line_no: 2, qty: 7 }]);
    await split([{ line_no: 1, qty: 27 }, { line_no: 2, qty: 23 }]);
    expect(await poSt(po)).toBe('converted');
    const t = await one<any>(`select sum(total) t from goods_receipts where po_id=$1 and status<>'cancelled'`, [po]);
    const p = await one<any>('select total from purchase_orders where id=$1', [po]);
    expect(+t.t).toBe(+p.total);
    expect(await onHand(a)).toBe(100); expect(await onHand(b)).toBe(30);
    const gl = await one<any>(`select coalesce(sum(l.credit-l.debit),0) b from journal_lines l join accounts x on x.id=l.account_id where x.code='21311'`);
    expect(+gl.b).toBe(+p.total);
  });
  it('ยกเลิก RI หลัง converted → กลับเป็น partial', async () => {
    const id = (await one<any>(`select id from goods_receipts where po_id=$1 and status<>'cancelled' order by ri_no desc limit 1`, [po])).id;
    await db.query('select cancel_goods_receipt($1)', [id]);
    expect(await poSt(po)).toBe('partial');
  });
});
