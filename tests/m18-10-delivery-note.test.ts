import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';

const dir = new URL('../supabase/migrations/', import.meta.url);
let db: PGlite; let cust: string, prod: string, svcProd: string;
const ACCOUNTS: [string, string, string][] = [
  ['11112', 'เงินสด', 'asset'], ['11311', 'ลูกหนี้การค้า', 'asset'], ['11319', 'ลูกหนี้อื่น', 'asset'], ['11500', 'สินค้าคงเหลือ', 'asset'],
  ['17120', 'ภาษีถูกหัก ณ ที่จ่าย', 'asset'], ['27111', 'ภาษีขาย', 'liability'], ['41110', 'รายได้ขายสินค้า', 'revenue'],
  ['41210', 'รายได้บริการ', 'revenue'], ['41400', 'รับคืน', 'revenue'], ['21921', 'มัดจำรับ', 'liability'],
];
const D = '2026-10-15';
const err = async (p: Promise<unknown>) => { try { await p; return ''; } catch (e) { return (e as Error).message; } };
const one = async <T = any>(q: string, a: unknown[] = []) => (await db.query<any>(q, a)).rows[0] as T;
const inv = async (h: object, lines: object[]) =>
  (await one<any>('select create_invoice_full($1::jsonb,$2::jsonb) id', [JSON.stringify({ date: D, contact: cust, ...h }), JSON.stringify(lines)])).id as string;
const L = (x: object = {}) => ({ description: 'บริการ', qty: 2, unit_price: 1000, ...x });
const get = (id: string) => one<any>('select * from sales_docs where id=$1', [id]);
const entries = async (v: string) =>
  (await db.query<any>(`select a.code, l.debit, l.credit from journal_lines l join accounts a on a.id=l.account_id where voucher_id=$1 order by a.code`, [v]))
    .rows.map(x => [x.code, +x.debit, +x.credit]);

beforeAll(async () => {
  db = new PGlite();
  for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(new URL(f, dir), 'utf8'));
});
beforeEach(async () => {
  await db.exec(`truncate receipt_items, receipts, billing_note_items, sales_doc_lines, sales_docs, stock_movements, product_stock, products, contacts,
                 journal_lines, journal_vouchers, period_locks, doc_sequences, accounts cascade`);
  for (const [c, n, t] of ACCOUNTS) await db.query('insert into accounts(code,name,type) values ($1,$2,$3)', [c, n, t]);
  cust = (await one<any>(`insert into contacts(business_name,tax_id,credit_days) values ('ลูกค้า ทดสอบ','0105500000001',30) returning id`)).id;
  prod = (await one<any>(`insert into products(code,name,kind,sale_price,base_unit) values ('TST-A','ตะแกรง A','goods_stock',750,'แผ่น') returning id`)).id;
  svcProd = (await one<any>(`insert into products(code,name,kind,sale_price) values ('SV-1','บริการ 1','service',1000) returning id`)).id;
});

const qt = async () => (await one<any>('select save_quotation(null,$1::jsonb,$2::jsonb) id', [JSON.stringify({ date: D, contact: cust, credit_days: 30 }), JSON.stringify([L()])])).id as string;
const set = (id: string, p: object) => one('select set_delivery($1,$2::jsonb)', [id, JSON.stringify(p)]);

describe('M18.10 ใบส่งของ: ข้อมูลจัดส่ง', () => {
  it('QT ที่ยังไม่อนุมัติกรอกข้อมูลจัดส่งไม่ได้ · อนุมัติแล้วกรอกได้', async () => {
    const q = await qt();
    expect(await err(set(q, { mode: 'pickup' }))).toContain('อนุมัติแล้ว');
    await db.query('select approve_quotation($1)', [q]);
    await set(q, { mode: 'ship', name: 'คุณสมศรี', address: '99 ถ.สุขุมวิท กทม. 10110', phone: '081-234-5678', carrier: 'Kerry', note: 'โทรก่อนส่ง' });
    const d = await get(q);
    expect([d.delivery_mode, d.ship_name, d.ship_address, d.ship_phone, d.carrier, d.delivery_note])
      .toEqual(['ship', 'คุณสมศรี', '99 ถ.สุขุมวิท กทม. 10110', '081-234-5678', 'Kerry', 'โทรก่อนส่ง']);
  });
  it('ส่งให้ต้องมีชื่อผู้รับและที่อยู่ · รับเอง ไม่บังคับ และล้างค่าที่อยู่/ขนส่ง', async () => {
    const q = await qt(); await db.query('select approve_quotation($1)', [q]);
    expect(await err(set(q, { mode: 'ship', name: 'ก' }))).toContain('ชื่อผู้รับและที่อยู่');
    expect(await err(set(q, { mode: 'x' }))).toContain('ไม่ถูกต้อง');
    await set(q, { mode: 'ship', name: 'ก', address: 'ข', carrier: 'Flash' });
    await set(q, { mode: 'pickup', name: 'ลูกค้ามารับเอง', address: 'ไม่ควรเก็บ', carrier: 'ไม่ควรเก็บ' });
    const d = await get(q);
    expect([d.delivery_mode, d.ship_name, d.ship_address, d.carrier]).toEqual(['pickup', 'ลูกค้ามารับเอง', null, null]);
  });
  it('ล้างข้อมูลจัดส่ง (mode ว่าง) และบันทึกประวัติ', async () => {
    const q = await qt(); await db.query('select approve_quotation($1)', [q]);
    await set(q, { mode: 'pickup' }); await set(q, {});
    expect((await get(q)).delivery_mode).toBeNull();
    expect(+(await one<any>(`select count(*) c from doc_events where doc_id=$1 and event='delivery'`, [q])).c).toBe(2);
  });
  it('แปลง QT→INV: ข้อมูลจัดส่งตามไปด้วย และ INV กรอก/แก้เองได้ ยกเลิกแล้วกรอกไม่ได้', async () => {
    const q = await qt(); await db.query('select approve_quotation($1)', [q]);
    await set(q, { mode: 'ship', name: 'คุณสมศรี', address: '99 กทม.', phone: '081', carrier: 'J&T' });
    const i = (await one<any>('select quotation_to_invoice($1,$2) id', [q, D])).id as string;
    const d = await get(i);
    expect([d.delivery_mode, d.ship_name, d.ship_address, d.ship_phone, d.carrier]).toEqual(['ship', 'คุณสมศรี', '99 กทม.', '081', 'J&T']);
    expect((await get(q)).status).toBe('converted');
    await set(q, { mode: 'pickup' });   // QT ที่แปลงแล้วยังแก้ได้
    await set(i, { mode: 'pickup', name: 'มารับเอง' });
    expect((await get(i)).delivery_mode).toBe('pickup');
    await db.query('select cancel_sales_doc($1)', [i]);
    expect(await err(set(i, { mode: 'pickup' }))).toContain('ไม่ได้ยกเลิก');
  });
  it('sales_doc_view ส่งฟิลด์จัดส่งออกไป', async () => {
    const q = await qt(); await db.query('select approve_quotation($1)', [q]);
    await set(q, { mode: 'ship', name: 'ก', address: 'ข', phone: '1', carrier: 'ค' });
    const v = (await one<any>('select sales_doc_view($1) v', [q])).v.doc;
    expect([v.delivery_mode, v.ship_name, v.ship_address, v.ship_phone, v.carrier]).toEqual(['ship', 'ก', 'ข', '1', 'ค']);
  });
});
