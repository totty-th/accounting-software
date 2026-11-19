-- M71 บันทึกค่าใช้จ่ายจากรูปบิล/PDF (โมดูลเสริม เปิด-ปิดได้)
-- เฟสแรก: อัปโหลดไฟล์ · ดูภาพข้างฟอร์ม · กรอกเอง · ประวัติ (ยังไม่มีตัวอ่านอัตโนมัติ)

create table if not exists app_modules (
  key        text primary key,
  enabled    boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references app_users(id)
);
insert into app_modules(key, enabled) values ('scan', false) on conflict do nothing;

create table doc_scans (
  id          uuid primary key default gen_random_uuid(),
  filename    text not null,
  mime        text not null check (mime in ('image/jpeg','image/png','application/pdf')),
  size        int  not null check (size > 0 and size <= 8000000),
  data        bytea not null,
  status      text not null default 'pending' check (status in ('pending','saved','discarded')),
  expense_id  uuid references expenses(id),
  scanned_no  text,            -- เลขที่เอกสารตามบิลของผู้ขาย
  doc_date    date,
  vendor_name text,
  total       numeric(18,2),
  extracted   jsonb,           -- ที่ว่างสำหรับผลจากตัวอ่านในเฟสถัดไป
  created_by  uuid references app_users(id),
  created_at  timestamptz not null default now(),
  saved_at    timestamptz,
  check ((status = 'saved') = (expense_id is not null))
);
create index on doc_scans (status, created_at desc);
create unique index on doc_scans (expense_id) where expense_id is not null;

create function doc_scan_add(p_name text, p_mime text, p_data bytea) returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  if not coalesce((select enabled from app_modules where key = 'scan'), false) then
    raise exception 'โมดูลบันทึกจากเอกสารยังไม่เปิดใช้งาน'; end if;
  if p_mime not in ('image/jpeg','image/png','application/pdf') then
    raise exception 'รองรับเฉพาะไฟล์ JPG, PNG หรือ PDF'; end if;
  if p_data is null or length(p_data) = 0 then raise exception 'ไฟล์ว่างเปล่า'; end if;
  if p_mime <> 'application/pdf' and length(p_data) > 4194304 then raise exception 'รูปภาพต้องไม่เกิน 4 MB'; end if;
  if length(p_data) > 8000000 then raise exception 'ไฟล์ PDF ต้องไม่เกิน 7.5 MB'; end if;
  insert into doc_scans(id, filename, mime, size, data, created_by)
  values (v_id, coalesce(nullif(trim(p_name), ''), 'เอกสาร'), p_mime, length(p_data), p_data, doc_event_actor());
  return v_id;
end $$;

-- บันทึกค่าใช้จ่ายจากไฟล์ (ทั้งหมดอยู่ในธุรกรรมเดียว: สร้างค่าใช้จ่าย + ผูกไฟล์)
create function doc_scan_save_expense(p_scan uuid, p_header jsonb, p_lines jsonb) returns uuid language plpgsql as $$
declare s doc_scans; v_exp uuid; e expenses;
begin
  select * into s from doc_scans where id = p_scan for update;
  if not found then raise exception 'ไม่พบไฟล์เอกสาร'; end if;
  if s.status = 'saved' then raise exception 'ไฟล์นี้บันทึกเป็นค่าใช้จ่ายไปแล้ว'; end if;
  if s.status = 'discarded' then raise exception 'ไฟล์นี้ถูกยกเลิกไปแล้ว'; end if;
  v_exp := save_expense(p_header, p_lines);
  select * into e from expenses where id = v_exp;
  update doc_scans set status = 'saved', expense_id = v_exp, saved_at = now(),
         scanned_no = nullif(trim(p_header->>'ref_no'), ''), doc_date = e.exp_date,
         vendor_name = (select coalesce(nullif(business_name,''), contact_name) from contacts where id = e.contact_id), total = e.total
   where id = p_scan;
  return v_exp;
end $$;

create function doc_scan_discard(p_scan uuid) returns void language plpgsql as $$
begin
  update doc_scans set status = 'discarded' where id = p_scan and status = 'pending';
  if not found then raise exception 'ยกเลิกได้เฉพาะไฟล์ที่ยังไม่บันทึก'; end if;
end $$;

create function doc_scan_restore(p_scan uuid) returns void language plpgsql as $$
begin
  update doc_scans set status = 'pending' where id = p_scan and status = 'discarded';
  if not found then raise exception 'ไม่พบไฟล์ที่ยกเลิกไว้'; end if;
end $$;

alter function doc_scan_add(text, text, bytea) set search_path = public, pg_temp;
alter function doc_scan_save_expense(uuid, jsonb, jsonb) set search_path = public, pg_temp;
alter function doc_scan_discard(uuid) set search_path = public, pg_temp;
alter function doc_scan_restore(uuid) set search_path = public, pg_temp;
alter table app_modules enable row level security;
alter table doc_scans enable row level security;
