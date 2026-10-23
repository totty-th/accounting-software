import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';

const dir = new URL('../supabase/migrations/', import.meta.url);
let db: PGlite;
let c30: string;
const ACCOUNTS: [string, string, string][] = [
  ['11112', 'เงินสด', 'asset'], ['11311', 'ลูกหนี้', 'asset'], ['11319', 'ใบเสร็จรอเรียกเก็บ', 'asset'],
  ['11500', 'สินค้าคงเหลือ', 'asset'], ['17113', 'ภาษีซื้อยังไม่ถึงกำหนด', 'asset'],
  ['21311', 'เจ้าหนี้การค้า', 'liability'], ['21399', 'เจ้าหนี้อื่นๆ', 'liability'], ['27111', 'ภาษีขาย', 'liability'],
  ['41110', 'รายได้ขายสินค้า', 'revenue'], ['41210', 'รายได้บริการ', 'revenue'], ['41400', 'รับคืนและส่วนลด', 'revenue'], ['51100', 'ต้นทุนขาย', 'expense'], ['53101', 'ค่าบริการ', 'expense'],
];
const one = async <T = any>(q: string, a: unknown[] = []) => (await db.query<any>(q, a)).rows[0] as T;
const inv = async (type = 'INV') =>
  (await one<{ id: string }>(`select create_sales_doc($1,$2::date,$3,$4::jsonb) as id`,
    [type, '2026-10-01', type === 'CA' ? null : c30, JSON.stringify([{ description: 'งานติดตั้ง', qty: 2, unit_price: 1000 }])])).id;

beforeAll(async () => {
  db = new PGlite();
  for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(new URL(f, dir), 'utf8'));
  for (const [c, n, t] of ACCOUNTS) await db.query('insert into accounts(code,name,type) values ($1,$2,$3)', [c, n, t]);
  await db.query(`insert into company_profile(name,address,tax_id) values ('บริษัททดสอบ','1 ถนนทดสอบ','0105500000001')`);
  c30 = (await one<{ id: string }>(`insert into contacts(business_name, credit_days, address, tax_id) values ('ลูกค้าเครดิต 30',30,'9 ซอยลูกค้า','0105500000002') returning id`)).id;
});

describe('M9 ลิงก์แชร์และข้อมูลเอกสาร', () => {
  it('สร้างรหัสลิงก์ 26 ตัวครั้งเดียว ขอซ้ำได้รหัสเดิม และค้นกลับเจอเอกสาร', async () => {
    const id = await inv();
    const t1 = (await one<{ t: string }>('select ensure_share_token($1) as t', [id])).t;
    const t2 = (await one<{ t: string }>('select ensure_share_token($1) as t', [id])).t;
    expect(t1).toMatch(/^[0-9a-f]{26}$/);
    expect(t2).toBe(t1);
    expect((await one<{ x: string }>('select sales_doc_by_token($1) as x', [t1])).x).toBe(id);
  });
  it('เพิกถอนลิงก์แล้วรหัสเดิมใช้ไม่ได้ และรหัสใหม่ไม่ซ้ำเดิม', async () => {
    const id = await inv();
    const t1 = (await one<{ t: string }>('select ensure_share_token($1) as t', [id])).t;
    await db.query('select revoke_share_token($1)', [id]);
    expect((await one<{ x: string | null }>('select sales_doc_by_token($1) as x', [t1])).x).toBeNull();
    const t2 = (await one<{ t: string }>('select ensure_share_token($1) as t', [id])).t;
    expect(t2).not.toBe(t1);
  });
  it('รหัสว่าง/null ไม่ตรงกับเอกสารใด', async () => {
    await inv();
    expect((await one<{ x: string | null }>('select sales_doc_by_token(null) as x')).x).toBeNull();
    expect((await one<{ x: string | null }>(`select sales_doc_by_token('') as x`)).x).toBeNull();
  });
  it('sales_doc_view คืนข้อมูลครบ: ลูกค้า บริษัท รายการ ยอด และใบสำคัญ', async () => {
    const id = await inv();
    const v = (await one<{ v: any }>('select sales_doc_view($1) as v', [id])).v;
    expect(v.doc.doc_type).toBe('INV');
    expect(+v.doc.total).toBe(2140);
    expect(v.contact).toMatchObject({ name: 'ลูกค้าเครดิต 30', address: '9 ซอยลูกค้า', tax_id: '0105500000002' });
    expect(v.company.name).toBe('บริษัททดสอบ');
    expect(v.lines).toHaveLength(1);
    expect(+v.lines[0].amount).toBe(2000);
    expect(v.doc.due_date.slice(0, 10)).toBe('2026-10-31');
    expect(v.vouchers.length).toBeGreaterThan(0);
  });
  it('เอกสารต่อยอดโยงกลับต้นทาง (ref) และต้นทางเห็นลูก (children) และใบเสร็จ', async () => {
    const q = await inv('QT');
    await db.query('select approve_quotation($1)', [q]);
    const i = (await one<{ id: string }>('select quotation_to_invoice($1,$2::date) as id', [q, '2026-10-02'])).id;
    const vi = (await one<{ v: any }>('select sales_doc_view($1) as v', [i])).v;
    expect(vi.ref.id).toBe(q);
    const vq = (await one<{ v: any }>('select sales_doc_view($1) as v', [q])).v;
    expect(vq.children.map((x: any) => x.id)).toContain(i);
    await db.query('select create_receipt_from_invoice($1,$2::date,$3)', [i, '2026-10-03', 500]);
    const vi2 = (await one<{ v: any }>('select sales_doc_view($1) as v', [i])).v;
    expect(vi2.receipts).toHaveLength(1);
    expect(+vi2.receipts[0].amount).toBe(500);
  });
  it('ไม่พบเอกสารให้ error', async () => {
    await expect(db.query(`select sales_doc_view('00000000-0000-0000-0000-000000000000')`)).rejects.toThrow('ไม่พบเอกสาร');
    await expect(db.query(`select ensure_share_token('00000000-0000-0000-0000-000000000000')`)).rejects.toThrow('ไม่พบเอกสาร');
  });
});

describe('M10 ข้อมูลเอกสาร A4 เพิ่มเติม', () => {
  it('ใบลดหนี้: เอกสารอ้างอิงมีวันที่และมูลค่าตามเอกสารเดิม', async () => {
    const i = await inv();
    const cn = (await one<{ id: string }>(`select create_sales_doc('CN','2026-10-02'::date,$1,$2::jsonb,'exclusive',7,$3,'ส่งคืนสินค้า') as id`,
      [c30, JSON.stringify([{ description: 'ลดราคา', qty: 1, unit_price: 500 }]), i])).id;
    const v = (await one<{ v: any }>('select sales_doc_view($1) as v', [cn])).v;
    expect(v.ref.doc_date).toBe('2026-10-01');
    expect([+v.ref.subtotal, +v.doc.subtotal]).toEqual([2000, 500]);
    expect(v.contact.credit_days).toBe(30);
  });
  it('ใบเสร็จ: รายการเอกสาร ยอด และแยกภาษีจากยอดรวม', async () => {
    const i = await inv();
    const re = (await one<{ id: string }>(`select create_receipt_from_invoice($1,'2026-10-05'::date,1070) as id`, [i])).id;
    const v = (await one<{ v: any }>('select receipt_view($1) as v', [re])).v;
    expect(v.items).toHaveLength(1);
    expect(v.items[0].doc_no).toMatch(/^INV/);
    expect(+v.receipt.amount).toBe(1070);
    expect([+v.receipt.base, +v.receipt.vat]).toEqual([1000, 70]);
    expect(v.contact.name).toBe('ลูกค้าเครดิต 30');
  });
});
