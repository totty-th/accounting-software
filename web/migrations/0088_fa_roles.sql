alter table app_users drop constraint app_users_role_check;
alter table app_users add constraint app_users_role_check check (role in
  ('super_admin','owner','accountant','sales','it','accounting_firm','sales_manager','senior_sales','sales_admin','cashier','sales_purchasing'));
