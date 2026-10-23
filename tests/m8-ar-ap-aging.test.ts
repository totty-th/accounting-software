import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';

// ชุดข้อมูลเลียนผลทดสอบต้นแบบ (วันที่รายงาน 23/10/2026) — ตัวเลขยอดรวมลูกหนี้ 52,833.05 / เจ้าหนี้ 26,108 ได้จากไฟล์ที่ส่งออกจริง
const dir = new URL('../supabase/migrations/', import.meta.url);
let db: PGlite;
let c30: string, c0: string, vendor: string;
const ACCOUNTS: [string, string, string][] = [
  ['11112', 'เงินสด', 'asset'], ['11311', 'ลูกหนี้', 'asset'], ['11319', 'ใบเสร็จรอเรียกเก็บ', 'asset'],
  ['11500', 'สินค้าคงเหลือ', 'asset'], ['17113', 'ภาษีซื้อยังไม่ถึงกำหนด', 'asset'],
  ['21311', 'เจ้าหนี้การค้า', 'liability'], ['21399', 'เจ้าหนี้อื่นๆ', 'liability'], ['27111', 'ภาษีขาย', 'liability'],
  ['41110', 'รายได้ขายสินค้า', 'revenue'], ['41210', 'รายได้บริการ', 'revenue'], ['41400', 'รับคืนและส่วนลด', 'revenue'], ['51100', 'ต้นทุนขาย', 'expense'], ['53101', 'ค่าบริการ', 'expense'],
];
const ASOF = '2026-10-23';
const one = async <T = any>(q: string, a: unknown[] = []) => (await db.query<any>(q, a)).rows[0] as T;
const rows = async (q: string, a: unknown[] = []) => (await db.query<any>(q, a)).rows;
const inv = async (date: string, net: number, contact = c30, type = 'INV') =>
  (await one<{ id: string }>(`select create_sales_doc($1,$2::date,$3,$4::jsonb) as id`,
    [type, date, type === 'CA' ? null : contact, JSON.stringify([{ description: 'งาน', qty: 1, unit_price: net }])])).id;
const exp = async (date: string, net: number) =>
  (await one<{ id: string }>(`select create_expense($1::date,$2,$3::jsonb) as id`,
    [date, vendor, JSON.stringify([{ description: 'ค่าบริการ', account: '53101', qty: 1, unit_price: net }])])).id;
const ar = (asof = ASOF) => rows('select * from ar_aging($1::date)', [asof]);
const ap = (asof = ASOF) => rows('select * from ap_aging($1::date)', [asof]);
const sum = (rs: any[], k: string) => Math.round(rs.reduce((s, r) => s + +r[k], 0) * 100) / 100;

beforeAll(async () => {
  db = new PGlite();
  for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(new URL(f, dir), 'utf8'));
});
beforeEach(async () => {
  await db.exec(`truncate stock_alerts, stock_movements, product_stock, goods_receipt_lines, goods_receipts, products, wht_certs,
    expense_lines, expenses, receipt_items, receipts, billing_note_items, sales_doc_lines, sales_docs, contacts,
    journal_lines, journal_vouchers, period_locks, doc_sequences, accounts cascade`);
  for (const [c, n, t] of ACCOUNTS) await db.query('insert into accounts(code,name,type) values ($1,$2,$3)', [c, n, t]);
  c30 = (await one<{ id: string }>(`insert into contacts(business_name, credit_days) values ('ลูกค้าเครดิต 30',30) returning id`)).id;
  c0 = (await one<{ id: string }>(`insert into contacts(business_name) values ('ลูกค้าสด 0') returning id`)).id;
  vendor = (await one<{ id: string }>(`insert into contacts(business_name) values ('ผู้ขาย') returning id`)).id;
});

describe('วันครบกำหนด', () => {
  it('ใช้เครดิตของผู้ติดต่อ แก้ต่อเอกสารได้', async () => {
    const a = await inv('2026-08-15', 10000), b = await inv('2026-08-15', 10000, c0);
    const d = async (id: string) => (await one<any>('select due_date::text d from sales_docs where id=$1', [id])).d;
    expect([await d(a), await d(b)]).toEqual(['2026-09-14', '2026-08-15']);
    await db.query(`select set_doc_due('sales',$1,'2026-12-01')`, [a]);
    expect(await d(a)).toBe('2026-12-01');
  });
  it('ช่วงอายุ: ครบกำหนดวันนี้ = ยังไม่เกินกำหนด, 1 วัน = 1-30, ขอบเขต 30/31/60/61/90/91', async () => {
    const t = (due: string) => one<any>('select aging_bucket($1::date,$2::date) b', [ASOF, due]).then(x => x.b);
    expect(await t('2026-10-23')).toBe('not_due'); expect(await t('2026-10-24')).toBe('not_due');
    expect(await t('2026-10-22')).toBe('d1_30'); expect(await t('2026-09-23')).toBe('d1_30');
    expect(await t('2026-09-22')).toBe('d31_60'); expect(await t('2026-08-24')).toBe('d31_60');
    expect(await t('2026-08-23')).toBe('d61_90'); expect(await t('2026-07-25')).toBe('d61_90');
    expect(await t('2026-07-24')).toBe('over90');
  });
});

describe('ลูกหนี้ตามเอกสาร', () => {
  it('ชุดเลียนต้นแบบ: ครบทุกช่วงอายุ + รับชำระบางส่วนที่เก็บเงินแล้ว', async () => {
    await inv('2026-05-15', 5000, c0);                       // 5,350 ค้าง 161 วัน → >90
    await inv('2026-07-15', 20000);                          // 21,400 ครบ 14/08 → 61-90
    const i3 = await inv('2026-08-15', 10000);               // 10,700 ครบ 14/09
    await inv('2026-10-23', 3235);                           // เครดิต 30 → ยังไม่เกินกำหนด
    const re = (await one<{ id: string }>(`select create_receipt_from_invoice($1,'2026-10-23'::date,4000) as id`, [i3])).id;
    await db.query(`select collect_receipt($1,'2026-10-23'::date)`, [re]);
    const r = await ar();
    const m = Object.fromEntries(r.map(x => [x.doc_no, x]));
    expect(+m['INV202608150001'].outstanding).toBe(6700);
    expect(+m['INV202608150001'].collected).toBe(4000);
    expect(m['INV202608150001'].bucket).toBe('d31_60');
    expect(m['INV202608150001'].receipt_refs).toBe('RE202610230001');
    expect(m['INV202607150001'].bucket).toBe('d61_90');
    expect(m['INV202605150001'].bucket).toBe('over90');
    expect(sum(r, 'outstanding')).toBe(5350 + 21400 + 6700 + 3461.45);
    expect([sum(r, 'not_due'), sum(r, 'd1_30'), sum(r, 'd31_60'), sum(r, 'd61_90'), sum(r, 'over90')]).toEqual([3461.45, 0, 6700, 21400, 5350]);
  });
  it('ใบเสร็จที่ยังไม่เก็บเงิน: ยังค้างเต็ม แต่แสดงยอดตามใบเสร็จ (ตามต้นแบบ)', async () => {
    const i = await inv('2026-10-22', 3000, c0);
    await db.query(`select create_receipt_from_invoice($1,'2026-10-22'::date,null)`, [i]);
    const [x] = await ar();
    expect([+x.doc_total, +x.receipted, +x.collected, +x.outstanding, x.bucket]).toEqual([3210, 3210, 0, 3210, 'd1_30']);
  });
  it('รีเซ็ตการเก็บเงินแล้วยอดค้างกลับมา · ใบเสร็จยกเลิกไม่นับ', async () => {
    const i = await inv('2026-10-22', 1000, c0);
    const re = (await one<{ id: string }>(`select create_receipt_from_invoice($1,'2026-10-22'::date,null) as id`, [i])).id;
    await db.query(`select collect_receipt($1,'2026-10-23'::date)`, [re]);
    expect(await ar()).toHaveLength(0);
    await db.query(`select reset_receipt($1)`, [re]);
    expect(sum(await ar(), 'outstanding')).toBe(1070);
    await db.query(`select cancel_receipt($1)`, [re]);
    const [x] = await ar();
    expect([+x.outstanding, +x.receipted]).toEqual([1070, 0]);
  });
  it('ใบลดหนี้ลดยอดค้าง (สมมติฐาน: ต้นแบบยังไม่ได้ทดสอบ) · ใบแจ้งหนี้ยกเลิกไม่แสดง · ขายสดรอเก็บเงินแสดง', async () => {
    const i = await inv('2026-10-22', 1000, c0);
    await db.query(`select create_sales_doc('CN','2026-10-22'::date,$1,$2::jsonb,'exclusive',7,$3,'คืนสินค้า')`,
      [c0, JSON.stringify([{ description: 'ลด', qty: 1, unit_price: 300 }]), i]);
    expect(sum(await ar(), 'outstanding')).toBe(749);
    const j = await inv('2026-10-22', 500, c0);
    await db.query(`select cancel_sales_doc($1)`, [j]);
    expect(await ar()).toHaveLength(1);
    const ca = await inv('2026-10-23', 1000, c0, 'CA');
    const r = await ar();
    expect(r.find(x => x.doc_id === ca)?.bucket).toBe('not_due');
    await db.query(`select collect_cash_sale($1,'2026-10-23'::date)`, [ca]);
    expect(await ar()).toHaveLength(1);
  });
  it('ย้อนดูตามวันที่ (as-of): เอกสารหลังวันที่รายงานไม่นับ', async () => {
    await inv('2026-10-22', 1000, c0);
    expect(await ar('2026-10-21')).toHaveLength(0);
    expect(await ar('2026-10-22')).toHaveLength(1);
  });
});

describe('เจ้าหนี้ตามเอกสาร', () => {
  it('ชุดเลียนต้นแบบ: ครบทุกช่วง รวมใบรับสินค้า 21311 และค่าใช้จ่าย 21399', async () => {
    await db.query(`update contacts set credit_days = 0`);
    await exp('2026-05-15', 3000);   // 3,210 >90
    await exp('2026-08-15', 8000);   // 8,560 61-90
    await exp('2026-09-10', 5000);   // 5,350 31-60
    const p = (await one<{ id: string }>(`insert into products(code,name,kind,purchase_price) values ('A','A','goods_stock',600) returning id`)).id;
    await db.query(`select create_goods_receipt('2026-10-22'::date,$1,$2::jsonb)`, [vendor, JSON.stringify([{ product_id: p, qty: 10, unit_price: 600 }])]);
    const r = await ap();
    expect(sum(r, 'outstanding')).toBe(3210 + 8560 + 5350 + 6420);
    expect([sum(r, 'not_due'), sum(r, 'd1_30'), sum(r, 'd31_60'), sum(r, 'd61_90'), sum(r, 'over90')]).toEqual([0, 6420, 5350, 8560, 3210]);
    expect(r.filter(x => x.doc_type === 'RI').map(x => x.liability_account)).toEqual(['21311']);
    expect(r.filter(x => x.doc_type === 'EXP').every(x => x.liability_account === '21399')).toBe(true);
  });
  it('จ่ายแล้วหายจากรายงาน · ยกเลิกไม่แสดง · รีเซ็ตการจ่ายแล้วกลับมา', async () => {
    const e = await exp('2026-10-22', 1000);
    expect(await ap()).toHaveLength(1);
    await db.query(`select pay_expense($1,'2026-10-23'::date)`, [e]);
    expect(await ap()).toHaveLength(0);
    await db.query(`select reset_expense($1)`, [e]);
    expect(await ap()).toHaveLength(1);
  });
});
