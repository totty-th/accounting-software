import { describe, it, expect } from 'vitest';
import { can, ROLES, PERMS, homeOf, salesScope, permsOf, isRole } from '../web/lib/permissions';

describe('M14 ตารางสิทธิ์', () => {
  it('ฝ่ายขาย: ใบเสนอราคาของตัวเองอย่างเดียว ไม่เห็นภาพรวม/รายงาน/ธนาคาร/ต้นทุน', () => {
    expect(can('sales', 'quote.own')).toBe(true);
    for (const p of ['dash.view', 'sales.read', 'sales.write', 'sales.approve', 'receipts.read', 'expenses.read', 'wht.read', 'stock.read',
      'bank.read', 'reports.read', 'cost.view', 'master.write', 'users.manage', 'settings.company'] as const) expect(can('sales', p), p).toBe(false);
    expect(homeOf('sales')).toBe('/sales'); expect(salesScope('sales')).toBe('own-quotes');
  });
  it('เจ้าของอนุมัติได้ทั้งขายและค่าใช้จ่าย แต่จัดการผู้ใช้ไม่ได้', () => {
    expect(can('owner', 'sales.approve') && can('owner', 'expenses.approve')).toBe(true);
    expect(can('owner', 'users.manage')).toBe(false); expect(can('owner', 'settings.company')).toBe(false);
  });
  it('นักบัญชีทำบัญชีได้ทุกหมวดแต่ไม่อนุมัติและไม่จัดการผู้ใช้', () => {
    for (const p of ['sales.write', 'receipts.write', 'expenses.write', 'wht.write', 'bank.write', 'reports.read'] as const) expect(can('accountant', p), p).toBe(true);
    expect(can('accountant', 'sales.approve')).toBe(false); expect(can('accountant', 'users.manage')).toBe(false);
  });
  it('IT เหมือน Super admin ทุกสิทธิ์; ทั้งคู่จัดการผู้ใช้ได้และไม่ลงบัญชี (อ่านอย่างเดียว)', () => {
    expect([...permsOf('it')].sort()).toEqual([...permsOf('super_admin')].sort());
    expect(can('super_admin', 'users.manage')).toBe(true);
    for (const p of PERMS.filter(p => p.endsWith('.write') || p.endsWith('.approve'))) expect(can('super_admin', p), p).toBe(false);
    expect(can('super_admin', 'reports.read')).toBe(true);
  });
  it('ไม่มีตำแหน่ง/ตำแหน่งแปลก = ไม่มีสิทธิ์อะไรเลย', () => {
    expect(can(null, 'dash.view')).toBe(false); expect(isRole('hacker')).toBe(false); expect(ROLES).toHaveLength(11);
  });
});

describe('M14.4 เอกสารของตัวเอง (sales.own) ตาม FA', () => {
  it('พนักงานขายอาวุโส/แคชเชียร์/เจ้าหน้าที่ขายและจัดซื้อ = เอกสารขายทุกประเภทของตัวเอง · ธุรการฝ่ายขาย/ฝ่ายขาย = ใบเสนอราคาเท่านั้น', () => {
    for (const r of ['senior_sales', 'cashier', 'sales_purchasing'] as const) {
      expect(salesScope(r)).toBe('own-all'); expect(can(r, 'sales.own')).toBe(true);
      expect(can(r, 'sales.write')).toBe(false); expect(can(r, 'cost.view')).toBe(false); expect(can(r, 'users.manage')).toBe(false);
    }
    for (const r of ['sales_admin', 'sales'] as const) { expect(salesScope(r)).toBe('own-quotes'); expect(can(r, 'sales.own')).toBe(false); }
    expect(salesScope('sales_manager')).toBe('all'); expect(salesScope('accountant')).toBe('all');
  });
});
