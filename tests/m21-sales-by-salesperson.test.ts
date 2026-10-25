import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';

const dir = new URL('../supabase/migrations/', import.meta.url);
let db: PGlite; let cust: string;
const ACCOUNTS: [string, string, string][] = [
  ['11112', 'เงินสด', 'asset'], ['11311', 'ลูกหนี้การค้า', 'asset'], ['11319', 'ลูกหนี้อื่น', 'asset'], ['11500', 'สินค้าคงเหลือ', 'asset'],
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

describe('M21 ยอดขายตามพนักงาน', () => {
  it('แยกกลุ่มตามพนักงาน + ไม่ระบุ + ผลรวมกลุ่ม = ยอดขายตามบัญชี', async () => {
    await inv('สมชาย', [L()]); await inv('สมชาย', [L({ unit_price: 500 })], 'CA'); await inv('สมหญิง', [L()]); await inv(null, [L({ unit_price: 100 })]);
    const g = await groups();
    const by = Object.fromEntries(g.map((r: any) => [r.salesperson, +r.sub]));
    expect(by['สมชาย']).toBe(3000); expect(by['สมหญิง']).toBe(2000); expect(by['ไม่ระบุพนักงาน']).toBe(200);
    const rc = (await one<any>('select sales_revenue_reconcile(null,null) r')).r;
    expect(g.reduce((s: number, r: any) => s + +r.sub, 0)).toBe(+rc.doc.total);
    expect(+rc.diff).toBe(0);
  });

  it('ยกเลิกไม่นับ · ใบลดหนี้ติดลบในกลุ่มของใบเดิม', async () => {
    const a = await inv('สมชาย', [L()]); const b = await inv('สมชาย', [L({ unit_price: 300 })]);
    await db.query('select cancel_sales_doc($1)', [b]);
    await db.query(`select create_sales_doc('CN',$1::date,$2,$3::jsonb,'exclusive',7,$4,'คืน')`, [D, cust, JSON.stringify([{ description: 'คืน', qty: 1, unit_price: 500 }]), a]);
    const g = await groups();
    const rc = (await one<any>('select sales_revenue_reconcile(null,null) r')).r;
    expect(g.reduce((s: number, r: any) => s + +r.sub, 0)).toBe(+rc.doc.total);
    expect(+rc.doc.total).toBe(2000 - 500);
  });

  it('ช่วงวันที่กรองได้ และนับลูกค้าไม่ซ้ำ', async () => {
    await inv('สมชาย', [L()]); await inv('สมชาย', [L()]);
    const g = (await db.query<any>(`select * from sales_by_salesperson('2026-10-01','2026-10-31')`)).rows;
    expect(g[0].doc_count).toBe(2); expect(g[0].customer_count).toBe(1);
    expect((await db.query<any>(`select * from sales_by_salesperson('2026-11-01',null)`)).rows.length).toBe(0);
  });
});
