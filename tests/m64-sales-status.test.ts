import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';

const dir = new URL('../supabase/migrations/', import.meta.url);
let db: PGlite; let cust: string, prod: string, svcProd: string;
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
const gl = async (code: string) => +(await one<any>(`select coalesce(sum(l.debit-l.credit),0) b from journal_lines l join accounts a on a.id=l.account_id where a.code=$1`, [code])).b;
const onhand = async () => +(await one<any>('select stock_on_hand($1) q', [prod])).q;

describe('M64 สถานะเอกสารขายแบบ FA', () => {
  it('ใบแจ้งหนี้: รอดำเนินการ → วางบิลแล้ว = รอเก็บเงิน → รีเซ็ต = รอดำเนินการ', async () => {
    const i = await inv({}, [L()]);
    expect(await sv(i)).toBe('inv_pending');
    await db.query('select invoice_set_billed($1,true)', [i]);
    expect(await sv(i)).toBe('awaiting_payment');
    expect(await err(db.query('select invoice_set_billed($1,true)', [i]))).toContain('วางบิลแล้ว');
    await db.query('select invoice_set_billed($1,false)', [i]);
    expect(await sv(i)).toBe('inv_pending');
    const ev = (await db.query<any>(`select detail from doc_events where doc_id=$1 and event='status' order by id`, [i])).rows.map(r => r.detail);
    expect(ev).toEqual(['inv_pending>awaiting_payment', 'awaiting_payment>inv_pending']);
  });
  it('ใบวางบิลจาก QT: รอวางบิล → วางบิลแล้ว → เปิดบิลแล้ว → รีเซ็ต · สร้างใบแจ้งหนี้จากใบวางบิล = รอเก็บเงิน', async () => {
    const q = await mk([L()], { ontop_type: 'amount', ontop_value: 100 });
    const b = await bill(q, 'BL');
    expect(await sv(b)).toBe('pending_billing');
    await db.query(`select billing_note_set_status($1,'billed')`, [b]); expect(await sv(b)).toBe('billed');
    await db.query(`select billing_note_set_status($1,'invoice_opened')`, [b]); expect(await sv(b)).toBe('invoice_opened');
    await db.query(`select billing_note_set_status($1,'pending_billing')`, [b]); expect(await sv(b)).toBe('pending_billing');
    const i = (await one<any>('select billing_note_to_invoice($1,$2) id', [b, D])).id;
    expect(await sv(i)).toBe('awaiting_payment');
    expect(await sv(b)).toBe('invoice_opened');
    expect([+(await get(i)).total, +(await get(i)).ontop_total]).toEqual([2033, 100]);
    expect(await err(db.query(`select billing_note_set_status($1,'pending_billing')`, [b]))).toContain('ยกเลิกใบแจ้งหนี้ก่อน');
    expect(await err(db.query('select cancel_sales_doc($1)', [b]))).toContain('ยกเลิกใบแจ้งหนี้ก่อน');
    await db.query('select cancel_sales_doc($1)', [i]);
    await db.query(`select billing_note_set_status($1,'pending_billing')`, [b]); expect(await sv(b)).toBe('pending_billing');
    await db.query('select cancel_sales_doc($1)', [b]); expect(await sv(b)).toBe('cancelled');
    await db.query('select reset_cancelled_sales_doc($1)', [b]); expect(await sv(b)).toBe('pending_billing');
  });
  it('ยกเลิก → รีเซ็ต ใบแจ้งหนี้: ลงบัญชีใหม่ (ใบเดิม/-R คงอยู่) ตัดสต็อกใหม่ กลับเป็นรอดำเนินการ', async () => {
    const i = await inv({}, [L({ product_id: prod, description: null, qty: 3 })]);
    const s0 = await onhand();
    await db.query('select invoice_set_billed($1,true)', [i]);
    await db.query('select cancel_sales_doc($1)', [i]);
    expect([await gl('11311'), await onhand()]).toEqual([0, s0 + 3]);
    await db.query('select reset_cancelled_sales_doc($1)', [i]);
    expect([await sv(i), await gl('11311'), await onhand()]).toEqual(['inv_pending', 3210, s0]);
    expect(+(await one<any>(`select count(*) n from journal_vouchers where source_id=$1`, [i])).n).toBe(3);
    await db.query('select cancel_sales_doc($1)', [i]); expect(await gl('11311')).toBe(0);
  });
  it('ยกเลิก → รีเซ็ต ขายสด กลับเป็นรอเก็บเงิน · ใบลด/เพิ่มหนี้ใช้เมนูเดิม', async () => {
    const c = (await one<any>('select create_invoice_full($1::jsonb,$2::jsonb,null,$3) id', [JSON.stringify({ date: D, contact: cust }), JSON.stringify([L()]), 'CA'])).id;
    await db.query('select collect_cash_sale($1,$2)', [c, D]);
    await db.query('select cancel_sales_doc($1)', [c]);
    expect([await gl('11319'), await gl('11112')]).toEqual([0, 0]);
    await db.query('select reset_cancelled_sales_doc($1)', [c]);
    expect([await sv(c), await gl('11319'), await gl('11112')]).toEqual(['pending_collect', 2140, 0]);
  });
  it('ใบเสร็จ: ยกเลิก → รีเซ็ต = รอดำเนินการ · กันรับเกินยอด', async () => {
    const i = await inv({}, [L()]);
    const r = (await one<any>('select create_receipt_from_invoice($1,$2) id', [i, D])).id;
    expect(await sv(i)).toBe('receipt_opened');
    await db.query('select cancel_receipt($1)', [r]);
    expect([await sv(i), await gl('11311')]).toEqual(['inv_pending', 2140]);
    await db.query('select reset_cancelled_receipt($1)', [r]);
    expect([(await one<any>('select status from receipts where id=$1', [r])).status, await sv(i), await gl('11311')]).toEqual(['pending', 'receipt_opened', 0]);
    await db.query('select cancel_receipt($1)', [r]);
    await one('select create_receipt_from_invoice($1,$2) id', [i, D]);
    expect(await err(db.query('select reset_cancelled_receipt($1)', [r]))).toContain('ยอดจะเกิน');
  });
});
