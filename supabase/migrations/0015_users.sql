-- M14 ผู้ใช้และตำแหน่ง
-- รหัสผ่านไม่เก็บในตารางนี้: เก็บที่ Supabase Auth (auth_user_id ชี้ไปที่ auth.users) · โหมดเดโมไม่มี Supabase ใช้รหัสเดโมฝั่งเว็บ
-- ตารางสิทธิ์ละเอียดต่อตำแหน่งอยู่ที่ web/lib/permissions.ts (จุดเดียว) — DB บังคับเฉพาะเรื่องผู้สร้างเอกสารและผู้ดูแลคนสุดท้าย

create table app_users (
  id           uuid primary key default gen_random_uuid(),
  username     text not null unique check (username ~ '^[a-z0-9][a-z0-9._-]{2,31}$'),
  display_name text not null check (length(btrim(display_name)) > 0),
  role         text not null check (role in ('super_admin','owner','accountant','sales','it')),
  auth_user_id uuid unique,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now()
);

create function app_user_create(p_username text, p_display text, p_role text, p_auth uuid default null) returns uuid
language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into app_users(id, username, display_name, role, auth_user_id)
  values (v_id, lower(btrim(p_username)), btrim(p_display), p_role, p_auth);
  return v_id;
exception
  when unique_violation then raise exception 'ชื่อผู้ใช้ % มีอยู่แล้ว', lower(btrim(p_username));
  when check_violation then raise exception 'ชื่อผู้ใช้ต้องเป็น a-z 0-9 . _ - ยาว 3-32 ตัว ขึ้นต้นด้วยตัวอักษรหรือตัวเลข และต้องระบุชื่อ/ตำแหน่งให้ถูกต้อง';
end $$;

-- ต้องเหลือผู้ดูแลระบบ (super_admin หรือ IT) ที่ใช้งานอยู่อย่างน้อย 1 คนเสมอ
create function app_users_keep_admin() returns trigger language plpgsql as $$
begin
  if not exists (select 1 from app_users where is_active and role in ('super_admin','it')) then
    raise exception 'ต้องมีผู้ดูแลระบบ (Super admin หรือ IT) ที่ใช้งานอยู่อย่างน้อย 1 คน';
  end if;
  return null;
end $$;
create constraint trigger app_users_keep_admin after update or delete on app_users
  deferrable initially immediate for each row execute function app_users_keep_admin();

-- ผู้สร้างเอกสารขาย (ฝ่ายขายเห็นเฉพาะใบเสนอราคาของตัวเอง)
-- เว็บตั้ง app.user_id ในคำสั่งเดียวกับที่สร้างเอกสาร: select set_config('app.user_id', <id>, true)
alter table sales_docs add column created_by uuid references app_users(id);
create index on sales_docs (created_by);
create function sales_docs_set_creator() returns trigger language plpgsql as $$
begin
  if new.created_by is null then
    new.created_by := nullif(current_setting('app.user_id', true), '')::uuid;
  end if;
  return new;
end $$;
create trigger sales_docs_set_creator before insert on sales_docs
  for each row execute function sales_docs_set_creator();
