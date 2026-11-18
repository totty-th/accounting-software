import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';

const dir = new URL('../supabase/migrations/', import.meta.url);
let db: PGlite; let cust: string, cust2: string, prod: string, svcProd: string;
const ACCOUNTS: [string, string, string][] = [
  ['11112', 'เงินสด', 'asset'], ['11311', 'ลูกหนี้การค้า', 'asset'], ['11319', 'ลูกหนี้อื่น', 'asset'], ['11500', 'สินค้าคงเหลือ', 'asset'], ['51111.01', 'ซื้อสินค้า', 'expense'],
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
  cust2 = (await one<any>(`insert into contacts(business_name) values ('ลูกค้าอื่น') returning id`)).id;
  svcProd = (await one<any>(`insert into products(code,name,kind,sale_price) values ('SV-1','บริการ 1','service',1000) returning id`)).id;
});

const mk = async (lines: object[] = [L()], h: object = {}) =>
  (await one<any>('select save_quotation(null,$1::jsonb,$2::jsonb) id', [JSON.stringify({ date: D, contact: cust, credit_days: 30, ...h }), JSON.stringify(lines)])).id as string;
const approve = (id: string) => db.query('select approve_quotation($1)', [id]);
const bill = async (qt: string, kind: string, mode = 'all', value: number | null = null, qtys: object | null = null) =>
  (await one<any>('select quotation_bill($1,$2,$3::date,$4,$5,$6::jsonb) id', [qt, kind, D, mode, value, qtys ? JSON.stringify(qtys) : null])).id as string;
const sum = async (qt: string) => (await one<any>('select quotation_billing_summary($1) s', [qt])).s;
const st = async (id: string) => (await get(id)).status as string;

const sv = async (id: string) => (await get(id)).status_view as string;
const cbl = async (invs: string[], h: object = {}, id: string | null = null) =>
  (await one<any>('select save_combined_billing($1,$2::jsonb,$3::uuid[]) id', [id, JSON.stringify({ date: D, contact: cust, credit_days: 30, ...h }), invs])).id as string;
const items = async (bl: string) => (await db.query<any>(`select d.doc_no, i.doc_total, i.wht, i.amount from billing_note_items i join sales_docs d on d.id=i.invoice_id
   where i.billing_id=$1 order by i.line_no`, [bl])).rows.map(r => [r.doc_no.slice(0, 2), +r.doc_total, +r.wht, +r.amount]);
const cn = (a: string, price = 500) => db.query(`select create_sales_doc('CN',$1::date,$2,$3::jsonb,'exclusive',7,$4,'คืน')`, [D, cust, JSON.stringify([{ description: 'คืน', qty: 1, unit_price: price }]), a]);

describe('M65 ใบวางบิลรวม (แบบ FA)', () => {
  it('รวมใบแจ้งหนี้หลายใบ + ใบลดหนี้ติดลบอัตโนมัติ · เริ่มรอวางบิล · ใบแจ้งหนี้เป็นรอเก็บเงิน · ไม่ลงบัญชี', async () => {
    const a = await inv({}, [L()]), b = await inv({}, [L({ qty: 1 })]);
    expect(await sv(a)).toBe('inv_pending');
    await cn(b);
    const vouchers = +(await one<any>('select count(*) n from journal_vouchers')).n;
    const bl = await cbl([a, b], { description: 'รวมบิลเดือน 10' });
    const d = await get(bl);
    expect([d.doc_type, d.status, d.is_combined, d.doc_no.startsWith('BL')]).toEqual(['BL', 'pending_billing', true, true]);
    expect(await items(bl)).toEqual([['IN', 2140, 0, 2140], ['IN', 1070, 0, 1070], ['CN', -535, 0, -535]]);
    expect([+d.total, +d.vat, +d.subtotal]).toEqual([2675, 175, 2500]);
    expect(d.due_date.toISOString().slice(0, 10)).toBe('2026-11-14');
    expect([await sv(a), await sv(b)]).toEqual(['awaiting_payment', 'awaiting_payment']);
    expect(+(await one<any>('select count(*) n from journal_vouchers')).n).toBe(vouchers);
  });

  it('หัก ณ ที่จ่ายคิดหลังหักใบลดหนี้ · ใบที่รับเงินบางส่วนใช้ยอดค้าง', async () => {
    const a = await inv({}, [L({ wht_rate: 3 })]);   // 2,000 + VAT 140 · WHT 60
    await cn(a);                                       // -535
    const bl = await cbl([a]);
    const [i0] = await items(bl);
    expect(i0[2]).toBeGreaterThan(0);
    expect(i0[3]).toBe(i0[1] - i0[2]);
  });

  it('ห้ามใบแจ้งหนี้ซ้ำในใบวางบิลรวมอื่น · ห้ามต่างลูกค้า · ตัวเลือกไม่แสดงใบที่ถูกถือ', async () => {
    const a = await inv({}, [L()]), b = await inv({}, [L()]);
    await cbl([a]);
    expect(await err(cbl([a, b]))).toMatch(/อยู่ในใบวางบิลรวม/);
    const other = (await one<any>('select create_invoice_full($1::jsonb,$2::jsonb) id', [JSON.stringify({ date: D, contact: cust2 }), JSON.stringify([L()])])).id;
    expect(await err(cbl([other]))).toMatch(/ลูกค้าเดียวกัน/);
    const cand = (await db.query<any>('select * from combined_bl_candidates($1)', [cust])).rows.map(r => r.id);
    expect(cand).toEqual([b]);
  });

  it('แก้ไขได้ขณะรอวางบิล (เพิ่ม/ลดใบ) · วางบิลแล้วแก้ไม่ได้', async () => {
    const a = await inv({}, [L()]), b = await inv({}, [L()]);
    const bl = await cbl([a]);
    await cbl([a, b], { description: 'แก้' }, bl);
    expect((await items(bl)).length).toBe(2);
    expect(+(await get(bl)).total).toBe(4280);
    await cbl([b], {}, bl);
    expect((await db.query<any>('select * from combined_bl_candidates($1)', [cust])).rows.map(r => r.id)).toEqual([a]);
    await db.query(`select billing_note_set_status($1,'billed')`, [bl]);
    expect(await err(cbl([a, b], {}, bl))).toMatch(/รอวางบิล/);
  });

  it('ใบแจ้งหนี้ที่อยู่ในใบวางบิลรวม: ยกเลิก/รีเซ็ตสถานะไม่ได้ · ยกเลิกใบวางบิลแล้วใบแจ้งหนี้ยังรอเก็บเงิน · รีเซ็ตกลับรอวางบิล', async () => {
    const a = await inv({}, [L()]);
    const bl = await cbl([a]);
    expect(await err(db.query('select cancel_sales_doc($1)', [a]))).toMatch(/ใบวางบิลรวม/);
    expect(await err(db.query('select invoice_set_billed($1,false)', [a]))).toMatch(/ใบวางบิลรวม/);
    expect(await err(db.query('select billing_note_to_invoice($1,$2::date)', [bl, D]))).toMatch(/ใบเสร็จรวม/);
    await db.query('select cancel_sales_doc($1)', [bl]);
    expect([await st(bl), await sv(a)]).toEqual(['cancelled', 'awaiting_payment']);
    await db.query('select reset_cancelled_sales_doc($1)', [bl]);
    expect(await st(bl)).toBe('pending_billing');
    // ถูกใบวางบิลรวมอื่นถือไว้แล้ว → รีเซ็ตไม่ได้
    await db.query('select cancel_sales_doc($1)', [bl]);
    await cbl([a]);
    expect(await err(db.query('select reset_cancelled_sales_doc($1)', [bl]))).toMatch(/อยู่ในใบวางบิลรวม/);
  });

  it('สร้างใบเสร็จรวม: อ้างอิงใบวางบิล · ใบวางบิล → เปิดใบเสร็จแล้ว · ยกเลิกใบเสร็จแล้วใบวางบิลไม่ย้อน (FA)', async () => {
    const a = await inv({}, [L()]), b = await inv({}, [L({ qty: 1 })]);
    await cn(b);
    const bl = await cbl([a, b]);
    await db.query(`select billing_note_set_status($1,'billed')`, [bl]);
    const r = (await one<any>('select combined_billing_receipt($1,$2::date) id', [bl, D])).id;
    const rc = await one<any>('select * from receipts where id=$1', [r]);
    expect([rc.kind, rc.billing_id, +rc.amount]).toEqual(['combined', bl, 2675]);
    expect(await st(bl)).toBe('receipt_opened');
    expect(await err(db.query('select combined_billing_receipt($1,$2::date)', [bl, D]))).toMatch(/ยังไม่ยกเลิก/);
    await db.query('select cancel_receipt($1)', [r]);
    expect(await st(bl)).toBe('receipt_opened');
    // ใบแจ้งหนี้ว่างให้ใส่ใบวางบิลรวมใหม่ได้
    expect((await db.query<any>('select * from combined_bl_candidates($1)', [cust])).rows.length).toBe(2);
  });

  it('create_billing_note เดิมยังใช้ได้ (สถานะวางบิลแล้ว)', async () => {
    const a = await inv({}, [L()]);
    const bl = (await one<any>('select create_billing_note($1::date,$2,$3::uuid[]) id', [D, cust, [a]])).id;
    expect([await st(bl), (await get(bl)).is_combined, +(await get(bl)).total]).toEqual(['billed', true, 2140]);
  });
});
