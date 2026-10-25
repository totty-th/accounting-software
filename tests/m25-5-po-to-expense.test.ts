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

describe('M25.5 PO → ค่าใช้จ่าย (ตามที่ทดสอบบน FA)', () => {
  it('สร้างได้ทุกหมวด · PO เป็นดำเนินการแล้ว · ผูก po_id + อ้างอิงเลข PO · EXP รอดำเนินการ', async () => {
    const id = await po();
    const e = await fromPo(id);
    const x = await one('select * from expenses where id=$1', [e]);
    expect([x.status, x.po_id, x.ref_no, +x.total]).toEqual(['pending', id, 'PO202610250001', 321]);
    expect((await one('select status from purchase_orders where id=$1', [id])).status).toBe('converted');
    expect(await err(fromPo(id))).toContain('รออนุมัติหรืออนุมัติแล้ว');             // แปลงซ้ำโดยไม่รีเซ็ตไม่ได้
  });
  it('บันทึกไม่สำเร็จ (ไม่เลือกหมวด) = PO ไม่เปลี่ยน', async () => {
    const id = await po();
    expect(await err(fromPo(id, ''))).toContain('หมวด');
    expect((await one('select status from purchase_orders where id=$1', [id])).status).toBe('pending');
    expect(+(await one('select count(*) c from expenses')).c).toBe(0);
  });
  it('รีเซ็ตแล้วสร้างใหม่ได้หลายใบ · ยกเลิก EXP ไม่กระทบ PO · ป๊อปอัปแสดงทุกใบ (รวมที่ยกเลิก) สองทาง', async () => {
    const id = await po();
    const e1 = await fromPo(id);
    await q('select reset_purchase_order($1)', [id]);
    expect((await one('select status from purchase_orders where id=$1', [id])).status).toBe('pending');
    expect((await one('select status from expenses where id=$1', [e1])).status).toBe('pending');   // EXP ไม่ถูกแตะ
    const e2 = await fromPo(id);
    await q('select cancel_expense($1)', [e2]);
    expect((await one('select status from purchase_orders where id=$1', [id])).status).toBe('converted');   // PO ไม่เปลี่ยน
    const m = await related(sdb, 'po', [id]);
    expect(m.get(id)!.map(r => r.kind + ':' + r.no).sort()).toEqual(['EXP:EXP202610250001', 'EXP:EXP202610250002']);
    const back = await related(sdb, 'exp', [e1, e2]);
    expect(back.get(e1)!.map(r => r.no)).toEqual(['PO202610250001']);
    expect(back.get(e2)!.map(r => r.kind)).toContain('PO');
  });
  it('รีเซ็ต PO ที่ดำเนินการแล้วด้วยการแปลงเป็น RI ได้เช่นกัน · ไม่รีเซ็ตใบที่ยังรออนุมัติ', async () => {
    const id = await po();
    expect(await err(q('select reset_purchase_order($1)', [id]))).toContain('รีเซ็ตได้เฉพาะ');
    await q('select upgrade_po_to_ri($1)', [id]);
    await q('select reset_purchase_order($1)', [id]);
    expect((await one('select status from purchase_orders where id=$1', [id])).status).toBe('pending');
    const m = await related(sdb, 'po', [id]);
    expect(m.get(id)!.map(r => r.kind)).toEqual(['RI']);            // ไม่ซ้ำแม้ผูกทั้ง po_id และ ri_id
  });
});
