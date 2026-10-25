import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { related } from '../web/lib/related';

const dir = new URL('../supabase/migrations/', import.meta.url);
let db: PGlite, v1: string, prod: string;
const ACC: [string, string, string][] = [['17113', 'ภาษีซื้อ', 'asset'], ['21399', 'เจ้าหนี้อื่น', 'liability'], ['21311', 'เจ้าหนี้การค้า', 'liability'],
  ['11500', 'สินค้าคงเหลือ', 'asset'], ['53101', 'ค่าโฆษณา', 'expense']];
const D = '2026-10-25';
const q = async <T = any>(s: string, a: unknown[] = []) => (await db.query<any>(s, a)).rows as T[];
const one = async <T = any>(s: string, a: unknown[] = []) => (await q<T>(s, a))[0];
const err = async (p: Promise<unknown>) => { try { await p; return ''; } catch (e) { return (e as Error).message; } };
const sdb = { q: async <T = any>(s: string, a?: unknown[]) => q<T>(s, a as unknown[]) };
const po = async () => (await one('select create_purchase_order($1::date,$2,$3::jsonb) id', [D, v1, JSON.stringify([{ product_id: prod, qty: 3, unit_price: 100 }])])).id;
const fromPo = async (id: string, acct = '53101') => (await one('select save_expense_from_po($1,$2::jsonb,$3::jsonb) id',
  [id, JSON.stringify({ date: D, contact: v1 }), JSON.stringify([{ description: 'x', account: acct, qty: 3, unit_price: 100 }])])).id;

beforeAll(async () => { db = new PGlite(); for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(new URL(f, dir), 'utf8')); });
beforeEach(async () => {
  await db.exec(`truncate purchase_order_lines, purchase_orders, expense_lines, expenses, stock_movements, product_stock, goods_receipt_lines, goods_receipts, products, contacts,
    journal_lines, journal_vouchers, period_locks, doc_sequences, accounts cascade`);
  for (const [c, n, t] of ACC) await q('insert into accounts(code,name,type) values ($1,$2,$3)', [c, n, t]);
  v1 = (await one(`insert into contacts(business_name) values ('ผู้ขาย') returning id`)).id;
  prod = (await one(`insert into products(code,name,kind,purchase_price,base_unit) values ('A','A','goods_stock',100,'ชิ้น') returning id`)).id;
});


const split = (id: string, mode: string, val: number, stock = false) => one('select split_ri_from_po($1,$2::date,$3,$4,$5) id', [id, D, mode, val, stock]);
const st = async (id: string) => (await one('select status from purchase_orders where id=$1', [id])).status;
const onhand = async () => +(((await one('select coalesce(sum(qty),0) q from product_stock where product_id=$1', [prod])) as any).q);

describe('M25.6 แบ่งจ่ายใบรับสินค้า (ตามที่ทดสอบบน FA)', () => {
  it('40% แล้ว 60%: PO แบ่งจ่าย → ดำเนินการแล้ว · ยอดรวมเท่า PO · สต็อกเข้าตอนใบสุดท้าย', async () => {
    const id = await po(); // 321
    const a = await split(id, 'percent', 40);
    expect(+(await one('select total from goods_receipts where id=$1', [a.id])).total).toBe(128.4);
    expect(await st(id)).toBe('partial');
    expect(await onhand()).toBe(0);
    const b = await split(id, 'percent', 60);
    expect(+(await one('select total from goods_receipts where id=$1', [b.id])).total).toBe(192.6);
    expect(await st(id)).toBe('converted');
    expect(await onhand()).toBe(3);
    expect(+(await one('select po_billed($1) b', [id])).b).toBe(321);
  });
  it('ติ๊กรับสต็อกใบแรก: เข้าทันที · ใบถัดไปติ๊กซ้ำไม่ได้ · จำนวนเงินแบ่งได้', async () => {
    const id = await po();
    await split(id, 'amount', 100, true);
    expect(await onhand()).toBe(3);
    expect(await err(split(id, 'amount', 50, true))).toContain('ครั้งเดียว');
    await split(id, 'amount', 221);
    expect(await onhand()).toBe(3);
    expect(await st(id)).toBe('converted');
  });
  it('เกิน 100% ได้ · รีเซ็ตแล้ว RI ไม่ถูกแตะ · ลิงก์ related ยังอยู่', async () => {
    const id = await po();
    await split(id, 'percent', 70);
    await split(id, 'percent', 70);
    expect(await st(id)).toBe('converted');
    await q('select reset_purchase_order($1)', [id]);
    expect(await st(id)).toBe('pending');
    expect((await one(`select count(*)::int c from goods_receipts where po_id=$1 and status<>'cancelled'`, [id])).c).toBe(2);
    expect((await related(sdb, 'po', [id])).get(id)?.length).toBe(2);
  });
  it('ค่าไม่ถูกต้อง/PO ที่ไม่อนุญาต', async () => {
    const id = await po();
    expect(await err(split(id, 'percent', 0))).toContain('มากกว่า 0');
    expect(await err(split(id, 'x', 10))).toContain('ไม่ถูกต้อง');
    await q('select cancel_purchase_order($1)', [id]);
    expect(await err(split(id, 'percent', 10))).toContain('แบ่งจ่ายได้เฉพาะ');
  });
});
