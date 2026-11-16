-- M14.3 ตำแหน่งผู้ใช้เพิ่มตาม FA (เจ้าของระบบสั่ง 16-11-2026 "ตาม FA เลย"): สำนักงานบัญชี, ผู้จัดการฝ่ายขาย, พนักงานขายอาวุโส, ธุรการฝ่ายขาย, แคชเชียร์, เจ้าหน้าที่ขายและจัดซื้อ
-- คงตำแหน่งเดิม 5 ตำแหน่งไว้ (super_admin, owner, accountant, sales, it) เพื่อไม่กระทบผู้ใช้ที่มีอยู่
alter table app_users drop constraint app_users_role_check;
alter table app_users add constraint app_users_role_check check (role in
  ('super_admin','owner','accountant','sales','it','accounting_firm','sales_manager','senior_sales','sales_admin','cashier','sales_purchasing'));
