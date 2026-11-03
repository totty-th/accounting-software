create table doc_number_formats (
  prefix        text primary key,                       -- รหัสชนิดเอกสารภายใน (QT, INV, ...)
  custom_prefix text not null check (custom_prefix ~ '^[A-Za-z0-9ก-๙_-]{1,10}$'),
  date_fmt      text not null default 'YYYYMMDD' check (date_fmt in ('none','YYYY','YYYYMM','YYYYMMDD')),
  seq_len       int  not null default 4 check (seq_len between 1 and 8),
  reset_mode    text not null default 'daily' check (reset_mode in ('never','yearly','monthly','daily')),
  updated_at    timestamptz not null default now(),
  check ( (date_fmt = 'none'     and reset_mode = 'never')
       or (date_fmt = 'YYYY'     and reset_mode in ('never','yearly'))
       or (date_fmt = 'YYYYMM'   and reset_mode in ('never','yearly','monthly'))
       or (date_fmt = 'YYYYMMDD') )
);
create unique index doc_number_formats_custom_uq on doc_number_formats (upper(custom_prefix));
create or replace function next_doc_no(p_prefix text, p_date date, p_daily boolean default false)
returns text language plpgsql as $$
declare f doc_number_formats;
        v_mode text; v_fmt text; v_pre text; v_len int; v_bucket date; v_no int;
begin
  select * into f from doc_number_formats where prefix = p_prefix;
  if found then v_mode := f.reset_mode; v_fmt := f.date_fmt; v_pre := f.custom_prefix; v_len := f.seq_len;
  else v_mode := case when p_daily then 'daily' else 'never' end;
       v_fmt  := case when p_daily then 'YYYYMMDD' else 'none' end; v_pre := p_prefix; v_len := 4; end if;
  v_bucket := case v_mode when 'daily' then p_date when 'monthly' then date_trunc('month', p_date)::date
                          when 'yearly' then date_trunc('year', p_date)::date else date '0001-01-01' end;
  insert into doc_sequences(prefix, bucket, last_no) values (p_prefix, v_bucket, 1)
  on conflict (prefix, bucket) do update set last_no = doc_sequences.last_no + 1 returning last_no into v_no;
  return v_pre || case v_fmt when 'none' then '' else to_char(p_date, v_fmt) end || lpad(v_no::text, v_len, '0');
end $$;
create function save_doc_number_format(p_prefix text, p_custom text, p_date_fmt text, p_seq int, p_reset text) returns void language plpgsql as $$
begin
  if p_prefix !~ '^[A-Z]{1,5}$' then raise exception 'ชนิดเอกสารไม่ถูกต้อง'; end if;
  begin
    insert into doc_number_formats(prefix, custom_prefix, date_fmt, seq_len, reset_mode) values (p_prefix, btrim(p_custom), p_date_fmt, p_seq, p_reset)
    on conflict (prefix) do update set custom_prefix = excluded.custom_prefix, date_fmt = excluded.date_fmt, seq_len = excluded.seq_len,
      reset_mode = excluded.reset_mode, updated_at = now();
  exception when unique_violation then raise exception 'คำนำหน้า % ซ้ำกับเอกสารชนิดอื่น', p_custom;
            when check_violation then raise exception 'รูปแบบเลขที่ไม่ถูกต้อง: วันที่ที่แสดงต้องไม่หยาบกว่าช่วงรีเซ็ตเลขลำดับ (กันเลขซ้ำ) และคำนำหน้ายาวไม่เกิน 10 ตัวอักษร';
  end;
end $$;
create function reset_doc_number_format(p_prefix text) returns void language sql as $$ delete from doc_number_formats where prefix = p_prefix $$;
create table doc_settings (
  singleton        boolean primary key default true check (singleton),
  price_mode       text not null default 'exclusive' check (price_mode in ('exclusive','inclusive')),
  vat_level        text not null default 'line' check (vat_level in ('line','footer')),
  discount_level   text not null default 'line' check (discount_level in ('line','footer')),
  wht_level        text not null default 'line' check (wht_level in ('line','footer')),
  show_warehouse   boolean not null default true,
  qr_tax_request   boolean not null default false,
  qr_self_register boolean not null default false,
  multi_currency   boolean not null default false,
  remarks          jsonb not null default '{}'::jsonb,   -- {"QT":"...","INV":"..."} หมายเหตุตั้งต้นต่อชนิดเอกสาร
  updated_at       timestamptz not null default now()
);
insert into doc_settings default values;
create function save_doc_settings(p jsonb) returns void language plpgsql as $$
declare k text;
begin
  for k in select jsonb_object_keys(coalesce(p->'remarks','{}'::jsonb)) loop
    if k not in ('QT','INV','CA','BL','CN','DN','PO','RI','EXP') then raise exception 'ชนิดเอกสารสำหรับหมายเหตุไม่ถูกต้อง: %', k; end if;
    if length(p->'remarks'->>k) > 1000 then raise exception 'หมายเหตุยาวเกิน 1000 ตัวอักษร'; end if;
  end loop;
  update doc_settings set
    price_mode = coalesce(p->>'price_mode', price_mode), vat_level = coalesce(p->>'vat_level', vat_level),
    discount_level = coalesce(p->>'discount_level', discount_level), wht_level = coalesce(p->>'wht_level', wht_level),
    show_warehouse = coalesce((p->>'show_warehouse')::boolean, show_warehouse),
    qr_tax_request = coalesce((p->>'qr_tax_request')::boolean, qr_tax_request),
    qr_self_register = coalesce((p->>'qr_self_register')::boolean, qr_self_register),
    multi_currency = coalesce((p->>'multi_currency')::boolean, multi_currency),
    remarks = coalesce(p->'remarks', remarks), updated_at = now();
end $$;
create table payment_infos (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('cash','transfer','cheque')),
  bank       text, account_no text, account_name text, branch text,
  cheque_payee text,
  remark     text check (remark is null or length(remark) <= 300),
  qr_img     text,
  is_active  boolean not null default true,
  sort_no    int not null default 0,
  created_at timestamptz not null default now(),
  check (kind <> 'transfer' or (coalesce(bank,'') <> '' and coalesce(account_no,'') <> '' and coalesce(account_name,'') <> '')),
  check (kind <> 'cheque' or coalesce(cheque_payee,'') <> '')
);
create function save_payment_info(p_id uuid, p jsonb) returns uuid language plpgsql as $$
declare v uuid := coalesce(p_id, gen_random_uuid());
begin
  insert into payment_infos(id, kind, bank, account_no, account_name, branch, cheque_payee, remark, qr_img, is_active)
  values (v, p->>'kind', nullif(btrim(p->>'bank'),''), nullif(btrim(p->>'account_no'),''), nullif(btrim(p->>'account_name'),''),
          nullif(btrim(p->>'branch'),''), nullif(btrim(p->>'cheque_payee'),''), nullif(btrim(p->>'remark'),''), nullif(p->>'qr_img',''),
          coalesce((p->>'is_active')::boolean, true))
  on conflict (id) do update set kind = excluded.kind, bank = excluded.bank, account_no = excluded.account_no, account_name = excluded.account_name,
    branch = excluded.branch, cheque_payee = excluded.cheque_payee, remark = excluded.remark,
    qr_img = coalesce(excluded.qr_img, payment_infos.qr_img), is_active = excluded.is_active;
  return v;
end $$;
create function remove_payment_info(p_id uuid) returns void language sql as $$ delete from payment_infos where id = p_id $$;
create table currencies (
  code      text primary key check (code ~ '^[A-Z]{3}$' and code <> 'THB'),
  name      text not null check (length(btrim(name)) > 0),
  symbol    text,
  rate      numeric(18,6) not null check (rate > 0),    -- 1 หน่วยสกุลนี้ = กี่บาท
  is_active boolean not null default true
);
create function save_currency(p_code text, p_name text, p_symbol text, p_rate numeric, p_active boolean) returns void language plpgsql as $$
begin
  if not (select multi_currency from doc_settings) then raise exception 'ต้องเปิดใช้งานหลายสกุลเงินก่อน'; end if;
  insert into currencies(code, name, symbol, rate, is_active) values (upper(btrim(p_code)), p_name, nullif(btrim(p_symbol),''), p_rate, p_active)
  on conflict (code) do update set name = excluded.name, symbol = excluded.symbol, rate = excluded.rate, is_active = excluded.is_active;
exception when check_violation then raise exception 'ข้อมูลสกุลเงินไม่ถูกต้อง (รหัส 3 ตัวอักษร ไม่ใช่ THB, อัตราต้องมากกว่า 0)';
end $$;
create function remove_currency(p_code text) returns void language sql as $$ delete from currencies where code = p_code $$;
