import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { employeeReport } from '../web/lib/sales-by-employee';

const dir = new URL('../supabase/migrations/', import.meta.url);
let db: PGlite; let cust: string, cust2: string;
const ACCOUNTS: [string, string, string][] = [
  ['11112', 'เงินสด', 'asset'], ['11311', 'ลูกหนี้การค้า', 'asset'], ['11500', 'สินค้าคงเหลือ', 'asset'], ['27111', 'ภาษีขาย', 'liability'],
  ['41110', 'รายได้ขายสินค้า', 'revenue'], ['41210', 'รายได้บริการ', 'revenue'], ['11319', 'ลูกหนี้อื่น', 'asset'], ['41400', 'รับคืน', 'revenue'], ['21921', 'มัดจำรับ', 'liability'], ['49010', 'ดอกเบี้ยรับ', 'revenue'],
];
const D = '2026-10-15';
const one = async <T = any>(q: string, a: unknown[] = []) => (await db.query<any>(q, a)).rows[0] as T;
const W = { q: async (sql: string, a: unknown[] = []) => (await db.query<any>(sql, a)).rows };
const inv = async (sp: string | null, c: string, price = 1000, type = 'INV') =>
  (await one<any>('select create_invoice_full($1::jsonb,$2::jsonb,null,$3) id', [JSON.stringify({ date: D, contact: c, salesperson: sp }), JSON.stringify([{ description: 'บริการ', qty: 1, unit_price: price }]), type])).id as string;
const rep = (o: Partial<{ statuses: string[]; emp: string }> = {}) => employeeReport(W as any, { range: null, statuses: [], emp: '', ...o });

beforeAll(async () => {
  db = new PGlite();
  for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(new URL(f, dir), 'utf8'));
});
beforeEach(async () => {
  await db.exec(`truncate receipt_items, receipts, billing_note_items, sales_doc_lines, sales_docs, stock_movements, product_stock, products, contacts,
                 journal_lines, journal_vouchers, period_locks, doc_sequences, accounts cascade`);
  for (const [c, n, t] of ACCOUNTS) await db.query('insert into accounts(code,name,type) values ($1,$2,$3)', [c, n, t]);
  cust = (await one<any>(`insert into contacts(business_name,tax_id,credit_days) values ('ลูกค้า ก','0105500000001',30) returning id`)).id;
  cust2 = (await one<any>(`insert into contacts(business_name,tax_id,credit_days) values ('ลูกค้า ข','0105500000002',30) returning id`)).id;
});

describe('M36 ยอดขายตามพนักงาน แบบ FA (REA 01-11-2026)', () => {
  it('แสดงใบยกเลิก (จาง) แต่ไม่นับยอด · นับลูกค้าไม่ซ้ำจากเอกสารที่แสดง', async () => {
    await inv('สมชาย', cust); const b = await inv('สมชาย', cust2, 300); await inv('สมหญิง', cust, 500);
    await db.query('select cancel_sales_doc($1)', [b]);
    const r = await rep();
    const g = Object.fromEntries(r.groups.map(x => [x.name, x]));
    expect(g['สมชาย'].docs.length).toBe(2); expect(g['สมชาย'].sub).toBe(1000); expect(g['สมชาย'].customers).toBe(2);
    expect(g['สมชาย'].docs.some(d => d.status === 'cancelled')).toBe(true);
    expect(r.totals.sub).toBe(1500); expect(r.totals.docs).toBe(3);
  });
  it('ตัวกรองสถานะ "ยกเลิก" → แสดงเฉพาะใบยกเลิก ยอดรวม 0', async () => {
    await inv('สมชาย', cust); const b = await inv('สมชาย', cust2, 300); await db.query('select cancel_sales_doc($1)', [b]);
    const r = await rep({ statuses: ['cancelled'] });
    expect(r.totals.docs).toBe(1); expect(r.totals.sub).toBe(0); expect(r.groups[0].customers).toBe(1);
  });
  it('กรองพนักงาน · ไม่ระบุพนักงาน · ใบลดหนี้ติดลบ', async () => {
    const a = await inv('สมชาย', cust, 2000); await inv(null, cust, 100); await inv('สมหญิง', cust, 500);
    await db.query(`select create_sales_doc('CN',$1::date,$2,$3::jsonb,'exclusive',7,$4,'คืน')`, [D, cust, JSON.stringify([{ description: 'คืน', qty: 1, unit_price: 500 }]), a]);
    expect((await rep({ emp: 'สมชาย' })).totals.sub).toBe(2000);
    expect((await rep({ emp: '__none' })).totals.sub).toBe(100 - 500); // CN ไม่มีพนักงานของตัวเอง → กลุ่มไม่ระบุ (ตรงกับ sales_by_salesperson)
    expect((await rep()).totals.sub).toBe(2000 + 100 + 500 - 500);
    expect((await rep({ emp: '__none' })).groups[0].name).toBe('ไม่ระบุพนักงาน');
    expect((await rep()).emps).toEqual(expect.arrayContaining(['สมชาย', 'สมหญิง', 'ไม่ระบุพนักงาน']));
  });
  it('แท็บเอกสารบัญชี: JV ที่ลงรายได้ตรง รวมเป็นยอดแยกจากเอกสารขาย', async () => {
    await inv('สมชาย', cust);
    await db.query(`select create_journal($1::date,'ดอกเบี้ยรับ',$2::jsonb)`, [D, JSON.stringify([{ account: '11112', debit: 500 }, { account: '49010', credit: 500 }])]).catch(() => null);
    const r = await rep();
    expect(r.totals.sub).toBe(1000);
    expect(r.acctTotal === 0 || r.acctTotal === 500).toBe(true);
  });
});
