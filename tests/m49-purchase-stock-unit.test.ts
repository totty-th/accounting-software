import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { COA } from '../web/lib/seed';

// ซื้อเป็น กก. (ราคาต่อกก.) แต่รับสต็อกเป็นแผ่นตามจำนวนจริง · ต้นทุนเฉลี่ยเคลื่อนที่ต่อแผ่น
const dir = new URL('../supabase/migrations/', import.meta.url);
let db: PGlite;
const one = async <T = any>(q: string, a: unknown[] = []) => (await db.query<any>(q, a)).rows[0] as T;
const J = JSON.stringify;
const err = async (p: Promise<unknown>) => { try { await p; return ''; } catch (e) { return (e as Error).message; } };
const onHand = async (p: string) => +(await one<any>('select stock_on_hand($1,null) v', [p])).v;
const avg = async (p: string) => +(await one<any>('select product_avg_cost($1) v', [p])).v;
let sup = '', ss = '';
const ri = async (lines: unknown[], date = '2026-11-01') =>
  (await one<any>('select save_goods_receipt($1::jsonb,$2::jsonb) id', [J({ date, contact: sup }), J(lines)])).id;

beforeAll(async () => {
  db = new PGlite();
  for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(new URL(f, dir), 'utf8'));
  for (const [c, n, t] of COA) await db.query('insert into accounts(code,name,type) values ($1,$2,$3) on conflict (code) do update set name=excluded.name,type=excluded.type', [c, n, t]);
  sup = (await one<any>(`insert into contacts(business_name,tax_id) values ('ซัพพลายเออร์','0105522222222') returning id`)).id;
  ss = (await one<any>(`insert into products(code,name,kind,sale_price,purchase_price,base_unit) values ('SS','สแตนเลสแผ่น','goods_stock',0,0,'แผ่น') returning id`)).id;
});

describe('ซื้อ กก. รับเป็นแผ่น', () => {
  it('RI 500 กก. @60 = 30,000 รับจริง 20 แผ่น → สต็อก 20 แผ่น, ต้นทุน 1,500/แผ่น', async () => {
    const id = await ri([{ product_id: ss, unit: 'กก.', qty: 500, unit_price: 60, stock_qty: 20 }]);
    expect(await onHand(ss)).toBe(20);
    expect(await avg(ss)).toBe(1500);
    const g = await one<any>('select subtotal, qty, stock_qty, unit from goods_receipt_lines l join goods_receipts r on r.id=l.ri_id where r.id=$1', [id]);
    expect(+g.subtotal).toBe(30000); expect(+g.qty).toBe(500); expect(+g.stock_qty).toBe(20); expect(g.unit).toBe('กก.');
    const m = await one<any>('select qty_in, unit_cost, value from stock_movements where doc_id=$1', [id]);
    expect(+m.qty_in).toBe(20); expect(+m.unit_cost).toBe(1500); expect(+m.value).toBe(30000);
  });
  it('ล็อตที่ 2 น้ำหนักต่างกัน: 300 กก. @64 = 19,200 ได้ 10 แผ่น → เฉลี่ย (30,000+19,200)/30 = 1,640', async () => {
    await ri([{ product_id: ss, unit: 'กก.', qty: 300, unit_price: 64, stock_qty: 10 }], '2026-11-02');
    expect(await onHand(ss)).toBe(30);
    expect(await avg(ss)).toBe(1640);
  });
  it('ต่างหน่วยแต่ไม่ระบุจำนวนแผ่น → error', async () => {
    expect(await err(ri([{ product_id: ss, unit: 'กก.', qty: 10, unit_price: 60 }]))).toContain('ต้องระบุจำนวน แผ่น');
    expect(await onHand(ss)).toBe(30);
  });
  it('หน่วยตรงกับหน่วยหลัก: stock_qty ถูกละ (ใช้ qty)', async () => {
    const id = await ri([{ product_id: ss, unit: 'แผ่น', qty: 2, unit_price: 1700, stock_qty: 99 }], '2026-11-03');
    expect(await onHand(ss)).toBe(32);
    expect((await one<any>('select stock_qty from goods_receipt_lines where ri_id=$1', [id])).stock_qty).toBeNull();
  });
  it('ยกเลิก RI คืนสต็อกเป็นจำนวนแผ่น', async () => {
    const id = await ri([{ product_id: ss, unit: 'กก.', qty: 100, unit_price: 60, stock_qty: 4 }], '2026-11-04');
    expect(await onHand(ss)).toBe(36);
    await db.query('select cancel_goods_receipt($1)', [id]);
    expect(await onHand(ss)).toBe(32);
  });
});

describe('PO → RI', () => {
  let po = '';
  it('PO เก็บ stock_qty · แบ่งรับตามจำนวน กก. → สต็อกเข้าตามสัดส่วน ครบบรรทัดรับเศษทั้งหมด', async () => {
    po = (await one<any>('select save_purchase_order(null,$1::jsonb,$2::jsonb) id', [J({ date: '2026-11-05', contact: sup, credit_days: 30 }),
      J([{ product_id: ss, unit: 'กก.', qty: 100, unit_price: 60, stock_qty: 10 }])])).id;
    await db.query('select approve_purchase_order($1)', [po]);
    const before = await onHand(ss);
    await db.query(`select split_ri_from_po_qty($1,'2026-11-06'::date,$2::jsonb)`, [po, J([{ line_no: 1, qty: 33 }])]);
    expect(await onHand(ss)).toBeCloseTo(before + 3.3, 4);
    await db.query(`select split_ri_from_po_qty($1,'2026-11-07'::date,$2::jsonb)`, [po, J([{ line_no: 1, qty: 67 }])]);
    expect(await onHand(ss)).toBeCloseTo(before + 10, 4);
    expect((await one<any>('select status from purchase_orders where id=$1', [po])).status).toBe('converted');
  });
  it('PO ต่างหน่วยไม่ระบุแผ่นจริง → error · duplicate เก็บ stock_qty', async () => {
    expect(await err(db.query('select save_purchase_order(null,$1::jsonb,$2::jsonb)', [J({ date: '2026-11-05', contact: sup }),
      J([{ product_id: ss, unit: 'กก.', qty: 5, unit_price: 60 }])]))).toContain('ต้องระบุจำนวน แผ่น');
    const d = (await one<any>('select duplicate_purchase_order($1) id', [po])).id;
    expect(+(await one<any>('select stock_qty from purchase_order_lines where po_id=$1', [d])).stock_qty).toBe(10);
  });
  it('แปลง PO → RI ทั้งใบ (upgrade) รับสต็อก 10 แผ่น', async () => {
    const p2 = (await one<any>('select save_purchase_order(null,$1::jsonb,$2::jsonb) id', [J({ date: '2026-11-08', contact: sup }),
      J([{ product_id: ss, unit: 'กก.', qty: 50, unit_price: 70, stock_qty: 2.5 }])])).id;
    const before = await onHand(ss);
    const r = (await one<any>('select upgrade_po_to_ri($1) id', [p2])).id;
    expect(await onHand(ss)).toBeCloseTo(before + 2.5, 4);
    const m = await one<any>('select unit_cost from stock_movements where doc_id=$1', [r]);
    expect(+m.unit_cost).toBe(1400);
  });
});
