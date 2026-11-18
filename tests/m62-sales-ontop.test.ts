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

const ln = async (id: string) => (await db.query<any>('select discount, ontop, amount, vat_rate, vat_exempt from sales_doc_lines where doc_id=$1 order by line_no', [id])).rows
  .map(r => [+r.discount, +r.ontop, +r.amount]);
const tot = async (id: string) => { const d = await get(id); return [+d.subtotal, +d.vat, +d.total, +d.discount_total, +d.ontop_total, +d.exempt_base]; };

describe('M62 ส่วนลด On Top ท้ายเอกสาร', () => {
  it('% : หักหลังส่วนลดบรรทัด ก่อน VAT · ปันตามสัดส่วน · บรรทัดยกเว้นภาษีถูกต้อง', async () => {
    const q = await mk([L({ discount_type: 'percent', discount_value: 10 }), L({ qty: 1, vat: 'exempt' })], { ontop_type: 'percent', ontop_value: 5 });
    // ฐาน 1,800 + 1,000 = 2,800 → On Top 140 → 90 / 50
    expect(await ln(q)).toEqual([[200, 90, 1710], [0, 50, 950]]);
    expect(await tot(q)).toEqual([2660, 119.7, 2779.7, 340, 140, 950]);
    const d = await get(q); expect([d.ontop_type, +d.ontop_value]).toEqual(['percent', 5]);
  });
  it('บาท: เศษสตางค์ลงบรรทัดมูลค่ามากสุด · เกินมูลค่า/เกิน 100% ไม่ได้', async () => {
    const q = await mk([L({ qty: 1 }), L({ qty: 1 }), L({ qty: 1 })], { ontop_type: 'amount', ontop_value: 100 });
    expect((await ln(q)).map(x => x[1])).toEqual([33.34, 33.33, 33.33]);
    expect(await tot(q)).toEqual([2900, 203, 3103, 100, 100, 0]);   // M67: VAT จากยอดรวมทั้งใบ 2,900 × 7% = 203.00 (เดิมปัดรายบรรทัดได้ 203.01)
    expect(await err(mk([L()], { ontop_type: 'amount', ontop_value: 5000 }))).toContain('เกินมูลค่า');
    expect(await err(mk([L()], { ontop_type: 'percent', ontop_value: 101 }))).toContain('เกิน 100');
  });
  it('ราคารวม VAT: On Top หักจากยอดรวมภาษี', async () => {
    const q = await mk([L({ qty: 1, unit_price: 1070 })], { price_mode: 'inclusive', ontop_type: 'amount', ontop_value: 70 });
    expect(await tot(q)).toEqual([934.58, 65.42, 1000, 70, 70, 0]);
  });
  it('QT → ใบแจ้งหนี้: ยอดเท่ากัน ลงบัญชีถูก · แบ่ง 50% ได้ On Top ครึ่งหนึ่ง · สร้างซ้ำคง On Top', async () => {
    const q = await mk([L({ discount_type: 'percent', discount_value: 10 }), L({ qty: 1, vat: 'exempt' })], { ontop_type: 'percent', ontop_value: 5 });
    await approve(q);
    const half = await bill(q, 'INV', 'percent', 50);
    expect((await ln(half)).map(x => x[1])).toEqual([45, 25]);
    const rest = await bill(q, 'INV');
    const a = await tot(half), b = await tot(rest);
    expect(Math.round((a[2] + b[2]) * 100) / 100).toBe(2779.7);
    const v = (await get(rest)).voucher_id;
    expect((await entries(v)).find(x => x[0] === '11311')![1]).toBe(b[2]);
    const dup = (await one<any>('select duplicate_quotation($1) id', [q])).id;
    expect(await tot(dup)).toEqual([2660, 119.7, 2779.7, 340, 140, 950]);
  });
  it('ใบแจ้งหนี้โดยตรง + แก้ไขเอกสาร (คงเลขเดิม) คำนวณ On Top ใหม่', async () => {
    const i = await inv({ ontop_type: 'amount', ontop_value: 200 }, [L()]);
    expect(await tot(i)).toEqual([1800, 126, 1926, 200, 200, 0]);
    await db.query('select create_invoice_full($1::jsonb,$2::jsonb,null,$3,$4)', [JSON.stringify({ date: D, contact: cust, ontop_type: 'percent', ontop_value: 50 }), JSON.stringify([L()]), 'INV', i]);
    expect(await tot(i)).toEqual([1000, 70, 1070, 1000, 1000, 0]);
  });
});
