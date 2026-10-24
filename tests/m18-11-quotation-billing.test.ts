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

const mk = async (lines: object[] = [L()], h: object = {}) =>
  (await one<any>('select save_quotation(null,$1::jsonb,$2::jsonb) id', [JSON.stringify({ date: D, contact: cust, credit_days: 30, ...h }), JSON.stringify(lines)])).id as string;
const approve = (id: string) => db.query('select approve_quotation($1)', [id]);
const bill = async (qt: string, kind: string, mode = 'all', value: number | null = null, qtys: object | null = null) =>
  (await one<any>('select quotation_bill($1,$2,$3::date,$4,$5,$6::jsonb) id', [qt, kind, D, mode, value, qtys ? JSON.stringify(qtys) : null])).id as string;
const sum = async (qt: string) => (await one<any>('select quotation_billing_summary($1) s', [qt])).s;
const st = async (id: string) => (await get(id)).status as string;

describe('M18.11 เรียกเก็บเงินจากใบเสนอราคา', () => {
  it('ข้ามการอนุมัติได้: QT รออนุมัติ → ใบแจ้งหนี้ทั้งใบ → QT ดำเนินการแล้ว', async () => {
    const q = await mk();
    const i = await bill(q, 'INV');
    const d = await get(i);
    expect([d.doc_type, d.status, d.ref_doc_id, +d.total]).toEqual(['INV', 'awaiting_payment', q, 2140]);
    expect(await st(q)).toBe('converted');
    expect(await err(bill(q, 'INV'))).toContain('รออนุมัติ อนุมัติแล้ว หรือแบ่งจ่าย');   // ออกซ้ำไม่ได้
  });
  it('ไม่อนุมัติแล้ว/ยกเลิกแล้ว สร้างต่อไม่ได้', async () => {
    const q = await mk(); await db.query('select reject_quotation($1)', [q]);
    expect(await err(bill(q, 'INV'))).toContain('แบ่งจ่าย');
  });
  it('แบ่งจ่าย 40% → ใบแจ้งหนี้ 856 / QT = แบ่งจ่าย · ที่เหลือ → ครบยอด = ดำเนินการแล้ว', async () => {
    const q = await mk(); await approve(q);
    const i1 = await bill(q, 'INV', 'percent', 40);
    expect(+(await get(i1)).total).toBe(856);
    expect(await st(q)).toBe('partial');
    const s = await sum(q);
    expect([+s.total, +s.billed, +s.remaining, +s.percent, s.docs.length, +s.lines[0].remaining_qty]).toEqual([2140, 856, 1284, 40, 1, 1.2]);
    const i2 = await bill(q, 'INV');   // ที่เหลือทั้งหมด
    expect(+(await get(i2)).total).toBe(1284);
    expect(await st(q)).toBe('converted');
    expect(+(await sum(q)).remaining).toBe(0);
  });
  it('แบ่งตามจำนวนเงิน 535 = 25% · แบ่งตามจำนวนสินค้า · เกินจำนวนคงเหลือไม่ได้', async () => {
    const q = await mk([L({ description: 'A', qty: 4, unit_price: 100 }), L({ description: 'B', qty: 2, unit_price: 500 })]); await approve(q);
    const i1 = await bill(q, 'INV', 'amount', 535);
    expect(Math.abs(+(await get(i1)).total - 535)).toBeLessThan(0.05);   // แบ่งตามยอดเงิน = สัดส่วนจำนวนต่อบรรทัด (ปัด 4 ตำแหน่ง) จึงคลาดได้ไม่กี่สตางค์
    const i2 = await bill(q, 'INV', 'qty', null, { 1: 1, 2: 0 });
    const l = await one<any>('select qty, src_line_no from sales_doc_lines where doc_id=$1', [i2]);
    expect([+l.qty, l.src_line_no]).toEqual([1, 1]);
    expect(await err(bill(q, 'INV', 'qty', null, { 1: 99 }))).toContain('เกินจำนวนคงเหลือ');
    expect(await err(bill(q, 'INV', 'qty', null, { 1: 0 }))).toContain('ไม่มีรายการที่จะเรียกเก็บ');
    expect(await err(bill(q, 'INV', 'percent', 150))).toContain('เกิน');
    expect(await err(bill(q, 'INV', 'percent'))).toContain('ระบุ');
  });
  it('ส่วนลดเป็นบาทปรับตามจำนวนที่เรียกเก็บ · VAT 0%/ยกเว้น/หัก ณ ที่จ่ายตามไปด้วย', async () => {
    const q = await mk([L({ qty: 4, unit_price: 1000, discount_type: 'amount', discount_value: 400, vat: 'exempt', wht_rate: 3 })]); await approve(q);
    const i = await bill(q, 'INV', 'percent', 50);   // qty 2, ส่วนลด 200
    const d = await get(i); const l = await one<any>('select * from sales_doc_lines where doc_id=$1', [i]);
    expect([+l.qty, +l.discount, +d.subtotal, +d.vat, +d.total, +d.wht_total]).toEqual([2, 200, 1800, 0, 1800, 54]);
  });
  it('ปิดยอดเอง (เก็บเงินทั้งหมด) และยกเลิกการปิดยอด', async () => {
    const q = await mk(); await approve(q);
    await bill(q, 'INV', 'percent', 40);
    await db.query('select close_quotation($1)', [q]);
    const s = await sum(q);
    expect([await st(q), +s.closed, +s.remaining, +s.percent]).toEqual(['converted', 1284, 0, 100]);
    await db.query('select reopen_quotation($1)', [q]);
    expect(await st(q)).toBe('partial');
    expect(await err(db.query('select reopen_quotation($1)', [q]))).toContain('ไม่มียอดที่ปิดไว้');
  });
  it('ดำเนินการแล้วกดเอง (ไม่มีเอกสาร) จาก QT ที่อนุมัติแล้ว · รออนุมัติทำไม่ได้ · รีเซ็ตกลับรออนุมัติ', async () => {
    const q = await mk();
    expect(await err(db.query('select close_quotation($1)', [q]))).toContain('อนุมัติแล้ว');
    await approve(q);
    await db.query('select close_quotation($1)', [q]);
    expect(await st(q)).toBe('converted');
    expect(await err(bill(q, 'INV'))).toContain('แบ่งจ่าย');
    await db.query('select reset_quotation($1)', [q]);
    expect(await st(q)).toBe('pending_approval');
    expect(+(await one<any>('select count(*) c from quotation_closeouts where qt_id=$1 and voided_at is null', [q])).c).toBe(0);
  });
  it('ยกเลิกใบแจ้งหนี้ที่ออกจาก QT → สถานะ QT คำนวณใหม่ · รีเซ็ตกันถ้ายังมีใบแจ้งหนี้', async () => {
    const q = await mk(); await approve(q);
    const i1 = await bill(q, 'INV', 'percent', 40); const i2 = await bill(q, 'INV', 'percent', 30);
    expect(await err(db.query('select reset_quotation($1)', [q]))).toContain('ผูกอยู่');
    await db.query('select cancel_sales_doc($1)', [i2]);
    expect(await st(q)).toBe('partial');
    expect(+(await sum(q)).billed).toBe(856);
    await db.query('select cancel_sales_doc($1)', [i1]);
    expect(await st(q)).toBe('approved');
    await db.query('select reset_quotation($1)', [q]);
    expect(await st(q)).toBe('pending_approval');
  });
  it('สร้างขายสด (CA) จาก QT: เดบิต 11319 · รอเก็บเงิน · ตัดสต็อก/ส่วนลดตามไป', async () => {
    const q = await mk([L({ discount_type: 'percent', discount_value: 10 })]); await approve(q);
    const c = await bill(q, 'CA');
    const d = await get(c);
    expect([d.doc_type, d.status, d.doc_no.startsWith('CA'), +d.total, d.due_date]).toEqual(['CA', 'pending_collect', true, 1926, null]);
    expect(await entries(d.voucher_id)).toEqual([['11319', 1926, 0], ['27111', 0, 126], ['41210', 0, 1800]]);
    expect(await st(q)).toBe('converted');
    await db.query('select cancel_sales_doc($1)', [c]);
    expect(await st(q)).toBe('approved');
  });
  it('สร้างใบวางบิลจาก QT: ไม่ลงบัญชี · QT ดำเนินการแล้ว · ซ้ำไม่ได้ · ยกเลิก BL แล้ว QT กลับอนุมัติแล้ว · รีเซ็ตได้ BL คงอยู่', async () => {
    const q = await mk(); await approve(q);
    const b = await bill(q, 'BL');
    const d = await get(b);
    expect([d.doc_type, d.status, +d.total, d.voucher_id, d.ref_doc_id]).toEqual(['BL', 'billed', 2140, null, q]);
    expect(+(await one<any>('select count(*) c from sales_doc_lines where doc_id=$1', [b])).c).toBe(1);
    expect(await st(q)).toBe('converted');
    expect(+(await sum(q)).billed).toBe(0);   // ใบวางบิลไม่นับเป็นยอดเรียกเก็บ
    await db.query('select cancel_sales_doc($1)', [b]);
    expect(await st(q)).toBe('approved');
    const b2 = await bill(q, 'BL');
    await db.query('select reset_quotation($1)', [q]);
    expect([await st(q), await st(b2)]).toEqual(['pending_approval', 'billed']);
  });
  it('ข้อมูลจัดส่งตามไปกับใบแจ้งหนี้ที่แบ่งจ่าย', async () => {
    const q = await mk(); await approve(q);
    await db.query(`select set_delivery($1,'{"mode":"ship","name":"ก","address":"ข"}'::jsonb)`, [q]);
    const i = await bill(q, 'INV', 'percent', 50);
    const d = await get(i);
    expect([d.delivery_mode, d.ship_name, d.ship_address]).toEqual(['ship', 'ก', 'ข']);
  });
  it('QT ไม่ลงบัญชี ไม่ตัดสต็อก ไม่นับในลูกหนี้ — มีผลเมื่อออกใบแจ้งหนี้เท่านั้น', async () => {
    const q = await mk([L({ product_id: prod, description: 'ตะแกรง A', qty: 5, unit_price: 750 })]); await approve(q);
    expect(+(await one<any>('select count(*) c from journal_vouchers')).c).toBe(0);
    await bill(q, 'INV', 'percent', 20);
    expect(+(await one<any>('select count(*) c from journal_vouchers')).c).toBe(1);
  });
});
