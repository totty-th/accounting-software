// ตารางสิทธิ์ตามตำแหน่ง — จุดเดียวที่ต้องแก้เมื่อเจ้าของระบบเปลี่ยนสิทธิ์
// สถานะ: ตำแหน่ง/คำตอบหลักมาจากเจ้าของระบบ ส่วนที่เป็น "ร่าง รอยืนยัน" ดูหมายเหตุท้ายไฟล์และ docs/spec.md (M14)
export const ROLES = ['super_admin', 'owner', 'accountant', 'sales', 'it',
  'accounting_firm', 'sales_manager', 'senior_sales', 'sales_admin', 'cashier', 'sales_purchasing'] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_LABEL: Record<Role, string> = {
  super_admin: 'Super admin', owner: 'เจ้าของ', accountant: 'นักบัญชี', sales: 'ฝ่ายขาย', it: 'IT',
  accounting_firm: 'สำนักงานบัญชี', sales_manager: 'ผู้จัดการฝ่ายขาย', senior_sales: 'พนักงานขายอาวุโส',
  sales_admin: 'ธุรการฝ่ายขาย (ใบเสนอราคา)', cashier: 'แคชเชียร์', sales_purchasing: 'เจ้าหน้าที่ขายและจัดซื้อ',
};

export const PERMS = [
  'dash.view',
  'sales.read', 'sales.write', 'sales.approve',      // เอกสารขายทุกประเภท
  'quote.own',                                       // ใบเสนอราคาของตัวเองเท่านั้น (สร้าง/ดู/พิมพ์/แชร์/ยกเลิก)
  'receipts.read', 'receipts.write',
  'expenses.read', 'expenses.write', 'expenses.approve',
  'wht.read', 'wht.write',
  'stock.read',
  'bank.read', 'bank.write',
  'reports.read',
  'master.read', 'master.write',                     // ลูกค้า/ผู้ขาย/สินค้า
  'journal.write',                                   // บันทึก/กลับรายการสมุดรายวันทั่วไป (M27.1)
  'accounts.write',                                  // ผังบัญชี · ยอดเริ่มต้น · ล็อกงวด · ปิดบัญชี (M27.3-4)
  'contact.create',
  'cost.view',                                       // เห็นราคาซื้อ/ต้นทุน
  'settings.company', 'users.manage',
] as const;
export type Perm = (typeof PERMS)[number];

const READ_ALL: Perm[] = ['dash.view', 'sales.read', 'receipts.read', 'expenses.read', 'wht.read', 'stock.read', 'bank.read',
  'reports.read', 'master.read', 'cost.view'];
const ACCOUNTING_WRITE: Perm[] = ['sales.write', 'receipts.write', 'expenses.write', 'wht.write', 'bank.write', 'master.write', 'contact.create', 'journal.write', 'accounts.write'];

const MATRIX: Record<Role, readonly Perm[]> = {
  // เจ้าของ: เห็นและอนุมัติบัญชีทั้งหมด (ตามที่เจ้าของระบบระบุ) · จัดการผู้ใช้/ตั้งค่าระบบไม่ได้
  owner: [...READ_ALL, ...ACCOUNTING_WRITE, 'sales.approve', 'expenses.approve'],
  // นักบัญชี: ทำงานบัญชีได้ทุกหมวด แต่ไม่อนุมัติ (ร่าง รอยืนยัน)
  accountant: [...READ_ALL, ...ACCOUNTING_WRITE],
  // ฝ่ายขาย: ใบเสนอราคาของตัวเองอย่างเดียว + ดูรายชื่อลูกค้า/สินค้า (ไม่เห็นราคาซื้อ) + เพิ่มลูกค้าได้
  sales: ['quote.own', 'master.read', 'contact.create'],
  // Super admin และ IT สิทธิ์เท่ากัน: จัดการผู้ใช้/สิทธิ์/ตั้งค่า + ดูข้อมูลทั้งหมดแบบอ่านอย่างเดียว (ร่าง รอยืนยัน)
  super_admin: [...READ_ALL, 'settings.company', 'users.manage'],
  it: [...READ_ALL, 'settings.company', 'users.manage'],
  // ตำแหน่งตาม FA (M14.3) — FA: สำนักงานบัญชี ≈ นักบัญชี (ปรับสิทธิ์รายคนได้ใน FA)
  accounting_firm: [...READ_ALL, ...ACCOUNTING_WRITE],
  // FA: ผู้จัดการฝ่ายขาย เมนูขาย+ใบลดหนี้/เพิ่มหนี้เต็ม, ดูได้แค่แดชบอร์ด, สินค้า/ลูกค้าไม่เห็นราคาซื้อ ไม่ลบ
  sales_manager: ['dash.view', 'sales.read', 'sales.write', 'receipts.read', 'receipts.write', 'master.read', 'contact.create'],
  // FA: พนักงานขายอาวุโส/ธุรการฝ่ายขาย/แคชเชียร์/เจ้าหน้าที่ขายและจัดซื้อ เห็นเฉพาะเอกสารของตัวเอง
  // ระบบเรารองรับ "เอกสารของตัวเอง" เฉพาะใบเสนอราคา (quote.own) จึงให้สิทธิ์เท่าฝ่ายขายไปก่อน (เข้มกว่า FA) — ขยายไปเอกสารขาย/ซื้ออื่นต้องรอเจ้าของระบบยืนยัน
  senior_sales: ['quote.own', 'master.read', 'contact.create'],
  sales_admin: ['quote.own', 'master.read', 'contact.create'],
  cashier: ['quote.own', 'master.read', 'contact.create'],
  sales_purchasing: ['quote.own', 'master.read', 'contact.create'],
};

export const isRole = (r: unknown): r is Role => ROLES.includes(r as Role);
export const can = (role: Role | null | undefined, perm: Perm): boolean => !!role && MATRIX[role].includes(perm);
export const permsOf = (role: Role): readonly Perm[] => MATRIX[role];
/** หน้าแรกหลังล็อกอิน: คนที่เปิดภาพรวมไม่ได้ (ฝ่ายขาย) ไปหน้าเอกสารขาย */
export const homeOf = (role: Role) => (can(role, 'dash.view') ? '/' : can(role, 'quote.own') ? '/sales' : '/forbidden');
/** ดูเอกสารขายได้ทุกใบหรือเฉพาะใบเสนอราคาของตัวเอง */
export const salesScope = (role: Role): 'all' | 'own-quotes' | 'none' =>
  can(role, 'sales.read') ? 'all' : can(role, 'quote.own') ? 'own-quotes' : 'none';
