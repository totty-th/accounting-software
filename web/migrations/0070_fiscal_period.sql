alter table company_profile
  add column fiscal_end_month int not null default 12 check (fiscal_end_month between 1 and 12),
  add column founded_on date;
create function save_fiscal_period(p_end_month int, p_founded date) returns void language plpgsql as $$
begin
  if p_end_month is null or p_end_month not between 1 and 12 then raise exception 'เดือนสิ้นงวดบัญชีไม่ถูกต้อง'; end if;
  if p_founded is not null and p_founded > today_th() then raise exception 'วันที่เริ่มจัดตั้งบริษัทต้องไม่เป็นอนาคต'; end if;
  update company_profile set fiscal_end_month = p_end_month, founded_on = p_founded;
  if not found then raise exception 'กรอกข้อมูลธุรกิจก่อน'; end if;
end $$;
