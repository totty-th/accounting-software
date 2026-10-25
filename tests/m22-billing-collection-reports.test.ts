import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';

const dir = new URL('../supabase/migrations/', import.meta.url);
let db: PGlite; let cust: string;
const ACCOUNTS: [string, string, string][] = [
  ['11112', 'เงินสด', 'asset'], ['11121', 'ธนาคาร', 'asset'], ['11311', 'ลูกหนี้การค้า', 'asset'], ['11319', 'ลูกหนี้อื่น', 'asset'], ['11500', 'สินค้าคงเหลือ', 'asset'],
  ['27111', 'ภาษีขาย', 'liability'], ['41110', 'รายได้ขายสินค้า', 'revenue'], ['41210', 'รายได้บริการ', 'revenue'], ['41400', 'รับคืน', 'revenue'],
  ['21921', 'มัดจำรับ', 'liability'],
];
const D = '2026-10-15';
const one = async <T = any>(q: string, a: unknown[] = []) => (await db.query<any>(q, a)).rows[0] as T;
const inv = async (sp: string | null, lines: object[], type = 'INV') =>
  (await one<any>('select create_invoice_full($1::jsonb,$2::jsonb,null,$3) id', [JSON.stringify({ date: D, contact: cust, salesperson: sp }), JSON.stringify(lines), type])).id as string;
const L = (x: object = {}) => ({ description: 'บริการ', qty: 2, unit_price: 1000, ...x });
const groups = async () => (await db.query<any>('select * from sales_by_salesperson(null,null)')).rows;

beforeAll(async () => {
  db = new PGlite();
  for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(new URL(f, dir), 'utf8'));
});
beforeEach(async () => {
  await db.exec(`truncate receipt_items, receipts, billing_note_items, sales_doc_lines, sales_docs, stock_movements, product_stock, products, contacts,
                 journal_lines, journal_vouchers, period_locks, doc_sequences, accounts cascade`);
  for (const [c, n, t] of ACCOUNTS) await db.query('insert into accounts(code,name,type) values ($1,$2,$3)', [c, n, t]);
  cust = (await one<any>(`insert into contacts(business_name,tax_id,credit_days) values ('ลูกค้า ทดสอบ','0105500000001',30) returning id`)).id;
});


const COLL = `select d.doc_no, d.status, d.total, (select string_agg(distinct rp.method, ',') from receipt_items ri join receipts r on r.id=ri.receipt_id and r.status<>'cancelled'
  join receipt_payments rp on rp.receipt_id=r.id where ri.doc_id=d.id) methods from sales_docs d where d.doc_type in ('INV','CA','DN') order by d.doc_no`;
describe('M22 รายงานใบวางบิล/การเก็บเงิน', () => {
  it('ใบวางบิล: ยอดรวมไม่นับที่ยกเลิก และไม่ลงบัญชี', async () => {
    const a = await inv(null, [L()]); const b = await inv(null, [L({ unit_price: 500 })]);
    const bl1 = (await one<any>('select create_billing_note($1::date,$2,$3::uuid[]) id', [D, cust, [a]])).id;
    const bl2 = (await one<any>('select create_billing_note($1::date,$2,$3::uuid[]) id', [D, cust, [b]])).id;
    await db.query('select cancel_sales_doc($1)', [bl2]);
    const r = await db.query<any>(`select status, total from sales_docs where doc_type='BL' order by doc_no`);
    expect(r.rows.length).toBe(2);
    const live = r.rows.filter((x: any) => x.status !== 'cancelled');
    expect(live.reduce((s: number, x: any) => s + +x.total, 0)).toBe(2140);
    expect(bl1).toBeTruthy();
    expect(+(await one<any>(`select count(*) n from journal_vouchers where source_type='BL'`)).n).toBe(0);
  });
  it('การเก็บเงิน: เก็บแล้วขึ้นช่องทางรับชำระ ยังไม่เก็บ = ไม่มีช่องทาง', async () => {
    const a = await inv(null, [L()]); await inv(null, [L({ unit_price: 500 })]);
    const rid = (await one<any>('select create_receipt_from_invoice($1,$2::date) id', [a, D])).id;
    await db.query('select collect_receipt($1,$2::date)', [rid, D]);
    const rows = (await db.query<any>(COLL)).rows;
    expect(rows.length).toBe(2);
    expect(rows.filter((x: any) => x.methods === 'cash').length).toBe(1);
    expect(rows.filter((x: any) => x.methods === null).length).toBe(1);
  });
});
