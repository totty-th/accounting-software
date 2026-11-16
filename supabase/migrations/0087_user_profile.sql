-- M14.2 ข้อมูลส่วนตัวผู้ใช้ (ตามหน้า "ข้อมูลส่วนตัว/เพิ่มผู้ใช้งาน" ของ FA): ชื่อ นามสกุล เบอร์โทร อีเมล
alter table app_users add column first_name text, add column last_name text, add column phone text, add column email text;
alter table app_users add constraint app_users_phone_chk check (phone is null or phone ~ '^[0-9+() -]{6,20}$');
alter table app_users add constraint app_users_email_chk check (email is null or email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$');

create function app_user_set_profile(p_id uuid, p_first text, p_last text, p_phone text, p_email text default null, p_set_email boolean default false) returns void
language plpgsql as $$
begin
  update app_users set first_name = nullif(btrim(p_first),''), last_name = nullif(btrim(p_last),''), phone = nullif(btrim(p_phone),''),
         email = case when p_set_email then nullif(lower(btrim(p_email)),'') else email end,
         display_name = case when nullif(btrim(coalesce(p_first,'')),'') is not null
                             then btrim(p_first) else display_name end
   where id = p_id;
  if not found then raise exception 'ไม่พบผู้ใช้'; end if;
exception when check_violation then raise exception 'เบอร์โทรหรืออีเมลไม่ถูกต้อง';
end $$;
