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


describe('M67 ภาษีขายคิดจากยอดรวมทั้งใบ', () => {
  const tot = async (id: string) => { const d = await get(id); return [+d.subtotal, +d.vat, +d.total]; };
  it('ราคาไม่รวม VAT: 3 × 33.33 + 0.07 + 7 × 14.29 = 200.09 → VAT 14.01 (เดิม 14.00) · ใบสำคัญสมดุล', async () => {
    const id = await inv({}, [L({ qty: 3, unit_price: 33.33 }), L({ qty: 1, unit_price: 0.07 }), L({ qty: 7, unit_price: 14.29 })]);
    expect(await tot(id)).toEqual([200.09, 14.01, 214.1]);
    const v = (await get(id)).voucher_id;
    expect(await entries(v)).toEqual([['11311', 214.1, 0], ['27111', 0, 14.01], ['41210', 0, 200.09]]);
  });
  it('3 บรรทัด × 0.05 → VAT 0.01 (เดิม 0.00)', async () => {
    const id = await inv({}, [L({ qty: 1, unit_price: 0.05 }), L({ qty: 1, unit_price: 0.05 }), L({ qty: 1, unit_price: 0.05 })]);
    expect(await tot(id)).toEqual([0.15, 0.01, 0.16]);
  });
  it('ราคารวม VAT: คงรายบรรทัดตาม FA (10 × 3 → 28.05 / 1.95) · สมดุล', async () => {
    const id = await inv({ price_mode: 'inclusive' }, [L({ qty: 1, unit_price: 10 }), L({ qty: 1, unit_price: 10 }), L({ qty: 1, unit_price: 10 })]);
    expect(await tot(id)).toEqual([28.05, 1.95, 30]);
    const e = await entries((await get(id)).voucher_id);
    expect(e.reduce((a, x) => a + x[1] - x[2], 0)).toBeCloseTo(0, 6);
  });
  it('รายการยกเว้น/0% ไม่นำมาคิด VAT', async () => {
    const id = await inv({}, [L({ qty: 1, unit_price: 1000 }), L({ qty: 1, unit_price: 500, vat: 'exempt' }), L({ qty: 1, unit_price: 300, vat: '0' })]);
    expect(await tot(id)).toEqual([1800, 70, 1870]);
  });
  it('ใบเสนอราคาคิดแบบเดียวกัน', async () => {
    const q = (await one<any>('select save_quotation(null,$1::jsonb,$2::jsonb) id', [JSON.stringify({ date: D, contact: cust }),
      JSON.stringify([L({ qty: 3, unit_price: 33.33 }), L({ qty: 1, unit_price: 0.07 }), L({ qty: 7, unit_price: 14.29 })])])).id;
    expect(await tot(q)).toEqual([200.09, 14.01, 214.1]);
  });
});
