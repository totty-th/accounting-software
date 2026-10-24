-- M16: สมุดรายชื่อครบฟิลด์ตามต้นแบบ (REA 24-10-2026) — แยกลูกค้า/ผู้จำหน่าย, บุคคลธรรมดา/นิติบุคคล, ในประเทศ/ต่างประเทศ,
--  สำนักงานใหญ่/สาขา, ที่อยู่/จัดส่ง, ผู้ติดต่อ, ธนาคาร, โน้ต
alter table contacts
  add column is_customer   boolean not null default true,
  add column is_vendor     boolean not null default true,    -- รายชื่อเดิมใช้ได้ทั้งสองฝั่ง
  add column contact_code  text unique,
  add column is_foreign    boolean not null default false,
  add column branch_code   text check (branch_code is null or branch_code ~ '^[0-9]{5}$'),   -- null = สำนักงานใหญ่
  add column branch_name   text,
  add column postal_code   text check (postal_code is null or postal_code ~ '^[0-9]{5}$'),
  add column shipping_info text,
  add column phone_office  text,
  add column phone_fax     text,
  add column website       text,
  add column person_email  text,
  add column person_mobile text,
  add column bank_name     text,
  add column bank_account_name text,
  add column bank_account_no   text,
  add column bank_branch   text,
  add column bank_account_type text check (bank_account_type in ('savings','current')),
  add column swift_code    text,
  add column bank_address  text,
  add column note          text,
  add constraint contacts_kind_chk check (is_customer or is_vendor or is_cash_default);
-- ต่างประเทศไม่มีเลขผู้เสียภาษีไทย: ผ่อนเช็ก 10/13 หลักเฉพาะรายต่างประเทศ
alter table contacts drop constraint contacts_tax_id_check;
alter table contacts add constraint contacts_tax_id_check
  check (tax_id is null or is_foreign or tax_id ~ '^[0-9]{10}$' or tax_id ~ '^[0-9]{13}$');

-- บันทึกผู้ติดต่อ (สร้าง/แก้) ตรวจกติกาในฐานข้อมูล
create function contact_save(p_id uuid, p jsonb) returns uuid language plpgsql as $$
declare v_id uuid := coalesce(p_id, gen_random_uuid()); v_for boolean := coalesce((p->>'is_foreign')::boolean, false);
        v_branch text := nullif(btrim(p->>'branch_code'), ''); v_cust boolean := coalesce((p->>'is_customer')::boolean, false);
        v_vend boolean := coalesce((p->>'is_vendor')::boolean, false); v_email text := nullif(btrim(p->>'person_email'), '');
        v_code text := nullif(btrim(p->>'contact_code'), '');
begin
  if not (v_cust or v_vend) and not exists (select 1 from contacts where id = p_id and is_cash_default) then
    raise exception 'ต้องเลือกประเภทอย่างน้อย 1 อย่าง (ลูกค้า/ผู้จำหน่าย)';
  end if;
  if coalesce(btrim(p->>'business_name'),'') = '' and coalesce(btrim(p->>'contact_name'),'') = '' then
    raise exception 'ต้องระบุชื่อธุรกิจหรือชื่อผู้ติดต่อ';
  end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'รูปแบบอีเมลไม่ถูกต้อง'; end if;
  if v_branch is not null and v_branch !~ '^[0-9]{5}$' then raise exception 'รหัสสาขาต้องเป็นตัวเลข 5 หลัก'; end if;
  if v_code is not null and exists (select 1 from contacts where contact_code = v_code and id <> v_id) then
    raise exception 'รหัสผู้ติดต่อ % ซ้ำ', v_code;
  end if;
  if nullif(btrim(p->>'tax_id'),'') is not null and not v_for and btrim(p->>'tax_id') !~ '^([0-9]{10}|[0-9]{13})$' then
    raise exception 'เลขผู้เสียภาษีต้องเป็นตัวเลข 10 หรือ 13 หลัก';
  end if;
  insert into contacts(id, business_name, contact_name, tax_id, person_kind, is_customer, is_vendor, contact_code, is_foreign,
      branch_code, branch_name, address, postal_code, shipping_info, credit_days, phone_office, phone_fax, website,
      person_email, person_mobile, bank_name, bank_account_name, bank_account_no, bank_branch, bank_account_type,
      swift_code, bank_address, note)
  values (v_id, nullif(btrim(p->>'business_name'),''), nullif(btrim(p->>'contact_name'),''), nullif(btrim(p->>'tax_id'),''),
      coalesce(nullif(p->>'person_kind',''), 'juristic'), v_cust, v_vend, v_code, v_for,
      v_branch, case when v_branch is null then null else nullif(btrim(p->>'branch_name'),'') end,
      nullif(btrim(p->>'address'),''), nullif(btrim(p->>'postal_code'),''), nullif(btrim(p->>'shipping_info'),''),
      coalesce(nullif(p->>'credit_days','')::int, 0), nullif(btrim(p->>'phone_office'),''), nullif(btrim(p->>'phone_fax'),''),
      nullif(btrim(p->>'website'),''), v_email, nullif(btrim(p->>'person_mobile'),''), nullif(btrim(p->>'bank_name'),''),
      nullif(btrim(p->>'bank_account_name'),''), nullif(btrim(p->>'bank_account_no'),''), nullif(btrim(p->>'bank_branch'),''),
      nullif(p->>'bank_account_type',''), nullif(btrim(p->>'swift_code'),''), nullif(btrim(p->>'bank_address'),''), nullif(btrim(p->>'note'),''))
  on conflict (id) do update set business_name=excluded.business_name, contact_name=excluded.contact_name, tax_id=excluded.tax_id,
      person_kind=excluded.person_kind, is_customer=excluded.is_customer, is_vendor=excluded.is_vendor, contact_code=excluded.contact_code,
      is_foreign=excluded.is_foreign, branch_code=excluded.branch_code, branch_name=excluded.branch_name, address=excluded.address,
      postal_code=excluded.postal_code, shipping_info=excluded.shipping_info, credit_days=excluded.credit_days,
      phone_office=excluded.phone_office, phone_fax=excluded.phone_fax, website=excluded.website, person_email=excluded.person_email,
      person_mobile=excluded.person_mobile, bank_name=excluded.bank_name, bank_account_name=excluded.bank_account_name,
      bank_account_no=excluded.bank_account_no, bank_branch=excluded.bank_branch, bank_account_type=excluded.bank_account_type,
      swift_code=excluded.swift_code, bank_address=excluded.bank_address, note=excluded.note;
  return v_id;
end $$;
