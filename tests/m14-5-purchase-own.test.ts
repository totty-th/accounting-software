import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { buyScope, can } from '../web/lib/permissions';

const dir = new URL('../supabase/migrations/', import.meta.url);
let db: PGlite;
const one = async <T = any>(q: string, a: unknown[] = []) => (await db.query<any>(q, a)).rows[0] as T;

beforeAll(async () => {
  db = new PGlite();
  for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(new URL(f, dir), 'utf8'));
  for (const [c, n, t] of [['17113', 'ภาษีซื้อ', 'asset'], ['21399', 'เจ้าหนี้อื่นๆ', 'liability'], ['53101', 'ค่าบริการ', 'expense']])
    await db.query('insert into accounts(code,name,type) values ($1,$2,$3) on conflict do nothing', [c, n, t]);
});

describe('M14.5 เอกสารซื้อของตัวเอง', () => {
  it('ผู้สร้างถูกบันทึกจาก app.user_id (ค่าใช้จ่าย/ใบสั่งซื้อ/ใบรับสินค้า) และเป็น null ถ้าไม่ระบุ', async () => {
    const vendor = (await one(`insert into contacts(business_name) values ('ผู้ขาย') returning id`)).id;
    const u = (await one(`select app_user_create('buyer1','คนซื้อ','sales_purchasing') as id`)).id;
    const e1 = (await one(`select create_expense('2026-11-01'::date,$1,$2::jsonb) id from (select set_config('app.user_id',$3,true)) _u`,
      [vendor, JSON.stringify([{ description: 'x', account: '53101', qty: 1, unit_price: 100 }]), u])).id;
    const e2 = (await one(`select create_expense('2026-11-01'::date,$1,$2::jsonb) id`, [vendor, JSON.stringify([{ description: 'y', account: '53101', qty: 1, unit_price: 50 }])])).id;
    expect((await one(`select created_by from expenses where id=$1`, [e1])).created_by).toBe(u);
    expect((await one(`select created_by from expenses where id=$1`, [e2])).created_by).toBeNull();
    await db.query(`select set_config('app.user_id',$1,false)`, [u]);
    const po = (await one(`insert into purchase_orders(po_no,po_date,contact_id) values ('PO-T1','2026-11-01',$1) returning created_by`, [vendor]));
    const ri = (await one(`insert into goods_receipts(ri_no,ri_date,contact_id) values ('RI-T1','2026-11-01',$1) returning created_by`, [vendor]));
    expect(po.created_by).toBe(u); expect(ri.created_by).toBe(u);
  });

  it('ขอบเขตสิทธิ์ตามตำแหน่ง: ซื้อของตัวเองเฉพาะเจ้าหน้าที่ขายและจัดซื้อ · ค่าใช้จ่ายของตัวเองรวมตำแหน่งขายอื่น', () => {
    expect(buyScope('sales_purchasing', 'PO')).toBe('own'); expect(buyScope('sales_purchasing', 'RI')).toBe('own');
    expect(buyScope('sales_purchasing', 'EXP')).toBe('own'); expect(buyScope('sales_purchasing', 'WT')).toBe('own');
    for (const r of ['sales_manager', 'senior_sales', 'sales_admin', 'cashier'] as const) {
      expect(buyScope(r, 'EXP')).toBe('own'); expect(buyScope(r, 'PO')).toBe('none'); expect(buyScope(r, 'RI')).toBe('none'); expect(buyScope(r, 'WT')).toBe('none');
    }
    for (const r of ['owner', 'accountant', 'accounting_firm'] as const) expect(buyScope(r, 'EXP')).toBe('all');
    expect(buyScope('sales', 'EXP')).toBe('none');
    expect(can('sales_purchasing', 'expenses.write')).toBe(false); expect(can('sales_purchasing', 'expenses.approve')).toBe(false);
  });
});
