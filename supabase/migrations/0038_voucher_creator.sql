-- ผู้ทำรายการของใบสำคัญ (FA: คอลัมน์ "ผู้ทำรายการ" ในรายงาน) — ตั้งจาก app.user_id เหมือน sales_docs
alter table journal_vouchers add column created_by uuid references app_users(id);
create function journal_vouchers_set_creator() returns trigger language plpgsql as $$
begin
  if new.created_by is null then
    new.created_by := nullif(current_setting('app.user_id', true), '')::uuid;
  end if;
  return new;
end $$;
create trigger journal_vouchers_set_creator before insert on journal_vouchers
  for each row execute function journal_vouchers_set_creator();
