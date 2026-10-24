import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';

const dir = new URL('../supabase/migrations/', import.meta.url);
let db: PGlite; let cust: string;
const ACCOUNTS: [string, string, string][] = [
  ['11112', 'เงินสด', 'asset'], ['11311', 'ลูกหนี้การค้า', 'asset'], ['11319', 'ลูกหนี้อื่น', 'asset'], ['11500', 'สินค้าคงเหลือ', 'asset'],
  ['27111', 'ภาษีขาย', 'liability'], ['41110', 'รายได้ขายสินค้า', 'revenue'], ['41210', 'รายได้บริการ', 'revenue'], ['41400', 'รับคืน', 'revenue'],
  ['21921', 'มัดจำรับ', 'liability'], ['49010', 'ดอกเบี้ยรับ', 'revenue'],
];
const D = '2026-10-15';
const one = async <T = any>(q: string, a: unknown[] = []) => (await db.query<any>(q, a)).rows[0] as T;
const inv = async (lines: object[], h: object = {}, type = 'INV') =>
  (await one<any>('select create_invoice_full($1::jsonb,$2::jsonb,null,$3) id', [JSON.stringify({ date: D, contact: cust, ...h }), JSON.stringify(lines), type])).id as string;
const rec = async (from: string | null = null, to: string | null = null) => (await one<any>('select sales_revenue_reconcile($1::date,$2::date) r', [from, to])).r;
const L = (x: object = {}) => ({ description: 'บริการ', qty: 2, unit_price: 1000, ...x });

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

describe('M19 รายงานขายตรงกับบัญชีรายได้', () => {
  it('INV + ขายสด + ส่วนลด + ยกเว้นภาษี: ผลต่างกับบัญชี = 0', async () => {
    await inv([L(), L({ discount_type: 'amount', discount_value: 300 }), L({ vat: 'exempt', unit_price: 500 })]);
    await inv([L()], {}, 'CA');
    const r = await rec();
    expect(+r.doc.inv).toBe(4700); // 2000 + (2000-300) + 1000
    expect(+r.doc.ca).toBe(2000);
    expect(+r.diff).toBe(0);
    expect(+r.gl.manual).toBe(0);
  });

  it('ยกเลิกเอกสาร: ไม่อยู่ในยอดเอกสาร และบัญชีหักล้างแล้ว ผลต่าง = 0', async () => {
    const a = await inv([L()]); await inv([L({ unit_price: 300 })]);
    await db.query('select cancel_sales_doc($1)', [a]);
    const r = await rec();
    expect(+r.doc.total).toBe(600);
    expect(+r.diff).toBe(0);
  });

  it('ใบลดหนี้เป็นลบ ใบเพิ่มหนี้เป็นบวก ผลต่าง = 0', async () => {
    const a = await inv([L()]);
    await db.query(`select create_sales_doc('CN',$1::date,$2,$3::jsonb,'exclusive',7,$4,'คืนสินค้า')`, [D, cust, JSON.stringify([{ description: 'คืน', qty: 1, unit_price: 500 }]), a]);
    await db.query(`select create_sales_doc('DN',$1::date,$2,$3::jsonb,'exclusive',7,$4,'เพิ่มราคา')`, [D, cust, JSON.stringify([{ description: 'เพิ่ม', qty: 1, unit_price: 200 }]), a]);
    const r = await rec();
    expect(+r.doc.cn).toBe(-500); expect(+r.doc.dn).toBe(200);
    expect(+r.doc.total).toBe(2000 - 500 + 200);
    expect(+r.diff).toBe(0);
  });

  it('ใบมัดจำไม่นับเป็นรายได้ รายได้เกิดที่ใบแจ้งหนี้ฉบับสุดท้าย', async () => {
    const q = (await one<any>('select save_quotation(null,$1::jsonb,$2::jsonb) id', [JSON.stringify({ date: D, contact: cust, credit_days: 30 }), JSON.stringify([L()])])).id;
    await db.query('select approve_quotation($1)', [q]);
    await db.query('select create_deposit_invoice($1,$2::date,500)', [q, D]);
    let r = await rec();
    expect(+r.doc.total).toBe(0); expect(+r.doc.deposit_excluded).toBe(500); expect(+r.diff).toBe(0);
    await db.query('select create_final_invoice($1,$2::date)', [q, D]);
    r = await rec();
    expect(+r.doc.total).toBe(2000); expect(+r.diff).toBe(0);
  });

  it('JV ที่ลงบัญชีรายได้ตรง ๆ แสดงแยก ไม่ปนในยอดขายและไม่ทำให้ผลต่างเพี้ยน', async () => {
    await inv([L()]);
    await db.query(`select post_voucher('JV',$1::date,'ดอกเบี้ยรับ',null,null,$2::jsonb)`, [D, JSON.stringify([{ account: '11112', debit: 500 }, { account: '49010', credit: 500 }, { account: '11112', debit: 300 }, { account: '41210', credit: 300 }])]);
    const r = await rec();
    expect(+r.doc.total).toBe(2000);
    expect(+r.gl.manual).toBe(300);          // เฉพาะหมวด 41 (49010 เป็นรายได้อื่น ไม่ใช่รายได้จากการขาย)
    expect(r.gl.manual_items).toHaveLength(1);
    expect(+r.diff).toBe(0);
  });

  it('กรองตามช่วงวันที่ทั้งฝั่งเอกสารและบัญชี', async () => {
    await inv([L()], { date: '2026-09-10' }); await inv([L({ unit_price: 300 })], { date: '2026-10-10' });
    const r = await rec('2026-10-01', '2026-10-31');
    expect(+r.doc.total).toBe(600); expect(+r.diff).toBe(0);
  });

  it('รายงานตามสินค้ารวมได้เท่ายอดเอกสาร (ราคารวม VAT / ส่วนลด / ยกเว้นภาษี / CN)', async () => {
    const a = await inv([L({ unit_price: 1070 }), L({ unit_price: 535, discount_type: 'percent', discount_value: 10 }), L({ vat: 'exempt', unit_price: 500 })], { price_mode: 'inclusive' });
    await inv([L()], {}, 'CA');
    await db.query(`select create_sales_doc('CN',$1::date,$2,$3::jsonb,'exclusive',7,$4,'คืนสินค้า')`, [D, cust, JSON.stringify([{ description: 'คืน', qty: 1, unit_price: 500 }]), a]);
    const r = await rec();
    const p = await one<any>('select coalesce(sum(net),0) s from sales_report_lines(null,null)');
    expect(+p.s).toBeCloseTo(+r.doc.total, 2);
    expect(+r.diff).toBe(0);
  });
});
