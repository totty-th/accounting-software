-- M61 โมดูลเงินเดือน ช่วง 1 (REA FA Payroll 16-11-2026, docs/rea-payroll.md) — โมดูลเสริม เปิด/ปิดได้ (payroll_settings.enabled) ไม่บังคับใช้
-- ตั้งค่า · ทะเบียนพนักงาน (รายเดือน/รายวัน) · รายการเงินเดือน (ประกันสังคม 5% เพดาน 17,500 · ภาษี 40(1) อัตโนมัติจากฐานเงินเดือน)
-- ลงบัญชีตาม FA: บันทึก = JV ค้างจ่ายทันที · จ่าย = JV จ่าย · รีเซ็ตการจ่าย = กลับรายการ JV จ่าย · ยกเลิก = กลับรายการ JV ค้างจ่าย
-- ต่างจาก FA (ตามหลักการระบบเรา): แก้รายการก่อนจ่าย = กลับรายการ JV ค้างจ่ายเดิม (-R) แล้วลงใหม่ (FA แก้ทับเลขเดิม — รอเจ้าของตัดสินใจ)
-- ยังไม่ได้ทดสอบบน FA (เลือกเอง รอยืนยัน): ค่าคอมมิชชั่น → 53011.03 · เงินหักอื่นๆ → 49920 เหมือนหักขาด/ลา

-- บัญชีที่ใช้ (สร้างถ้ายังไม่มี)
insert into accounts(code, name, type)
select c, n, t from (values
  ('53011.01','เงินเดือน ค่าแรง','expense'), ('53011.02','ค่าล่วงเวลา','expense'), ('53011.03','ค่าคอมมิชชั่นพนักงาน','expense'),
  ('53012.01','เงินสมทบประกันสังคม','expense'), ('21951.01','เงินเดือน/ค่าจ้างค้างจ่าย','liability'),
  ('21952.01','เงินประกันสังคมรอนำส่ง','liability'), ('27121','ภาษีหัก ณ ที่จ่าย - ภ.ง.ด. 1','liability'),
  ('49920','เงินชดเชยและค่าปรับ','revenue'), ('53211','ค่าธรรมเนียมธนาคาร','expense')) v(c, n, t)
where not exists (select 1 from accounts a where a.code = v.c);

create table payroll_settings (
  id              boolean primary key default true check (id),
  enabled         boolean not null default false,
  bank_account_id uuid references bank_accounts(id),
  sso_enabled     boolean not null default false,
  sso_employer_no text, sso_branch text,
  sso_rate        numeric(5,2) not null default 5 check (sso_rate between 0 and 10),
  sso_wage_min    numeric(18,2) not null default 1650,
  sso_wage_cap    numeric(18,2) not null default 17500,
  pvd_enabled     boolean not null default false,          -- กองทุนสงเคราะห์ลูกจ้าง (FA เลื่อนเริ่ม 1 ม.ค. 2027 — ยังไม่คำนวณ)
  wcf_office text, wcf_phone text, wcf_code text,
  wcf_rate        numeric(5,2) check (wcf_rate is null or wcf_rate between 0.1 and 3),
  updated_at      timestamptz not null default now()
);
insert into payroll_settings(id) values (true);

create table employees (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique check (length(btrim(code)) > 0),
  title         text not null default 'นาย',
  first_name    text not null check (length(btrim(first_name)) > 0),
  last_name     text not null check (length(btrim(last_name)) > 0),
  nickname      text, first_name_en text, last_name_en text,
  nationality   text not null default 'ไทย',
  national_id   text check (national_id is null or national_id ~ '^[0-9]{13}$'),
  passport_no   text,
  phone text, email text, line_id text, address text, emergency_name text, emergency_phone text,
  department    text, position text,
  hire_date     date not null,
  probation_days int not null default 90 check (probation_days >= 0),
  status        text not null default 'probation' check (status in ('probation','active','resigned')),
  birth_date    date, note text,
  pay_type      text not null default 'monthly' check (pay_type in ('monthly','daily')),
  salary        numeric(18,2) not null default 0 check (salary >= 0),   -- รายเดือน = เงินเดือน · รายวัน = ค่าจ้างต่อวัน
  sso           boolean not null default true,
  auto_tax      boolean not null default true,
  pay_method    text not null default 'transfer' check (pay_method in ('cash','transfer')),
  bank_name text, bank_account_no text, bank_account_type text default 'savings', bank_branch text,
  created_at    timestamptz not null default now()
);

create function thai_id_valid(p text) returns boolean language sql immutable as $$
  select p ~ '^[0-9]{13}$' and
    (11 - (select sum(substr(p, i, 1)::int * (14 - i)) from generate_series(1, 12) i) % 11) % 10 = substr(p, 13, 1)::int
$$;

create table payroll_runs (
  id            uuid primary key default gen_random_uuid(),
  pay_type      text not null check (pay_type in ('monthly','daily')),
  pay_method    text not null check (pay_method in ('cash','transfer')),
  doc_date      date not null, period_from date not null, period_to date not null, pay_date date not null,
  status        text not null default 'pending' check (status in ('pending','paid','cancelled')),
  note          text,
  accrual_voucher_id uuid references journal_vouchers(id),
  payment_voucher_id uuid references journal_vouchers(id),
  paid_date     date, fee numeric(18,2) not null default 0,
  created_by    uuid references app_users(id),
  created_at    timestamptz not null default now(),
  check (period_to >= period_from)
);
create table payroll_lines (
  run_id       uuid not null references payroll_runs(id) on delete cascade,
  employee_id  uuid not null references employees(id),
  days         numeric(6,2) not null default 0,
  rate         numeric(18,2) not null default 0,
  base         numeric(18,2) not null default 0,     -- เงินเดือน หรือ วัน × ค่าจ้าง
  ot numeric(18,2) not null default 0, commission numeric(18,2) not null default 0,
  absence numeric(18,2) not null default 0, other_deduct numeric(18,2) not null default 0,
  sso_employee numeric(18,2) not null default 0, sso_employer numeric(18,2) not null default 0,
  wht_401 numeric(18,2) not null default 0, wht_402 numeric(18,2) not null default 0,
  net numeric(18,2) not null default 0,
  slip_note text,
  primary key (run_id, employee_id)
);

-- ประกันสังคม: อัตรา × ค่าจ้าง (ต่ำสุด/เพดานตามตั้งค่า) ปัดเป็นบาท
create function payroll_sso(p_wage numeric) returns numeric language sql stable as $$
  select case when p_wage <= 0 then 0 else
    round(least(greatest(p_wage, s.sso_wage_min), s.sso_wage_cap) * s.sso_rate / 100) end
  from payroll_settings s
$$;
-- ภาษีเงินได้บุคคลธรรมดาทั้งปี (อัตราก้าวหน้า)
create function pit_annual(p_net numeric) returns numeric language sql immutable as $$
  select round(coalesce(sum((least(greatest(p_net, lo), hi) - lo) * r), 0), 2)
  from (values (0,150000,0), (150000,300000,0.05), (300000,500000,0.10), (500000,750000,0.15),
               (750000,1000000,0.20), (1000000,2000000,0.25), (2000000,5000000,0.30), (5000000,1e15,0.35)) b(lo, hi, r)
$$;
-- ภาษีหัก ณ ที่จ่ายต่อเดือนแบบ FA: ประมาณเงินเดือน × 12 − ค่าใช้จ่าย 50% (ไม่เกิน 100,000) − ลดหย่อนตัวเอง 60,000 − ประกันสังคมทั้งปี → ภาษีทั้งปี ÷ 12
create function payroll_wht_monthly(p_salary numeric, p_sso numeric) returns numeric language sql immutable as $$
  select round(pit_annual(greatest(p_salary * 12 - least(p_salary * 12 * 0.5, 100000) - 60000 - p_sso * 12, 0)) / 12, 2)
$$;
-- รายละเอียดการคำนวณ (แสดงในฟอร์มพนักงาน)
-- ภาษีของเงินได้ไม่ประจำ (OT/คอมมิชชั่น หักด้วยเงินหักขาด/ลา/สาย) ตามวิธีกรมสรรพากร:
-- ภาษีทั้งปีของ (เงินเดือน×12 + เงินได้ไม่ประจำ) − ภาษีทั้งปีของ (เงินเดือน×12) → หักทั้งก้อนในเดือนที่จ่าย
create function payroll_pit_year(p_income numeric, p_sso_year numeric) returns numeric language sql immutable as $$
  select pit_annual(greatest(p_income - least(p_income * 0.5, 100000) - 60000 - p_sso_year, 0))
$$;
create function payroll_wht_extra(p_salary numeric, p_sso numeric, p_extra numeric) returns numeric language sql immutable as $$
  select case when coalesce(p_extra, 0) = 0 then 0 else
    round(payroll_pit_year(p_salary * 12 + p_extra, p_sso * 12) - payroll_pit_year(p_salary * 12, p_sso * 12), 2) end
$$;
create function payroll_tax_breakdown(p_salary numeric, p_sso boolean default true) returns jsonb language sql stable as $$
  with x as (select p_salary * 12 y, case when p_sso then payroll_sso(p_salary) else 0 end s)
  select jsonb_build_object('salary', p_salary, 'annual', y, 'expense', least(y * 0.5, 100000),
    'after_expense', y - least(y * 0.5, 100000), 'personal', 60000, 'sso', s * 12,
    'net', greatest(y - least(y * 0.5, 100000) - 60000 - s * 12, 0),
    'tax_year', pit_annual(greatest(y - least(y * 0.5, 100000) - 60000 - s * 12, 0)),
    'tax_month', payroll_wht_monthly(p_salary, s), 'sso_month', s) from x
$$;

create function payroll_enabled_check() returns void language plpgsql as $$
begin
  if not (select enabled from payroll_settings) then raise exception 'ยังไม่ได้เปิดใช้โมดูลเงินเดือน (ตั้งค่าเงินเดือน)'; end if;
end $$;

create function save_payroll_settings(p jsonb) returns void language plpgsql as $$
begin
  if coalesce((p->>'sso_enabled')::boolean, false) and (nullif(btrim(p->>'sso_employer_no'),'') is null or nullif(btrim(p->>'sso_branch'),'') is null) then
    raise exception 'ประกันสังคมขึ้นสิทธิ์ ต้องระบุเลขที่บัญชีนายจ้างและลำดับที่สาขา';
  end if;
  update payroll_settings set enabled = coalesce((p->>'enabled')::boolean, enabled),
    bank_account_id = nullif(p->>'bank_account_id','')::uuid,
    sso_enabled = coalesce((p->>'sso_enabled')::boolean, false),
    sso_employer_no = nullif(btrim(p->>'sso_employer_no'),''), sso_branch = nullif(btrim(p->>'sso_branch'),''),
    pvd_enabled = coalesce((p->>'pvd_enabled')::boolean, false),
    wcf_office = nullif(btrim(p->>'wcf_office'),''), wcf_phone = nullif(btrim(p->>'wcf_phone'),''), wcf_code = nullif(btrim(p->>'wcf_code'),''),
    wcf_rate = nullif(p->>'wcf_rate','')::numeric, updated_at = now();
end $$;

create function save_employee(p_id uuid, p jsonb) returns uuid language plpgsql as $$
declare v uuid := coalesce(p_id, gen_random_uuid()); nid text := nullif(regexp_replace(coalesce(p->>'national_id',''), '[^0-9]', '', 'g'), '');
begin
  perform payroll_enabled_check();
  if nullif(btrim(p->>'code'),'') is null then raise exception 'ต้องระบุรหัสพนักงาน'; end if;
  if nullif(btrim(p->>'first_name'),'') is null or nullif(btrim(p->>'last_name'),'') is null then raise exception 'ต้องระบุชื่อและนามสกุล'; end if;
  if coalesce(p->>'nationality','ไทย') = 'ไทย' and nid is null then raise exception 'ต้องระบุเลขบัตรประชาชน'; end if;
  if nid is not null and not thai_id_valid(nid) then raise exception 'เลขบัตรประชาชนไม่ถูกต้อง'; end if;
  if nullif(p->>'hire_date','') is null then raise exception 'ต้องระบุวันที่จ้างงาน'; end if;
  if coalesce((p->>'salary')::numeric, 0) <= 0 then raise exception 'ต้องระบุ%', case when p->>'pay_type' = 'daily' then 'ค่าจ้างต่อวัน' else 'เงินเดือน' end; end if;
  if coalesce(p->>'pay_method','transfer') = 'transfer' and (nullif(btrim(p->>'bank_name'),'') is null or nullif(btrim(p->>'bank_account_no'),'') is null) then
    raise exception 'รับเงินแบบโอน ต้องระบุธนาคารและเลขที่บัญชี';
  end if;
  insert into employees(id, code, title, first_name, last_name, nickname, first_name_en, last_name_en, nationality, national_id, passport_no,
      phone, email, line_id, address, emergency_name, emergency_phone, department, position, hire_date, probation_days, status, birth_date, note,
      pay_type, salary, sso, auto_tax, pay_method, bank_name, bank_account_no, bank_account_type, bank_branch)
  values (v, btrim(p->>'code'), coalesce(nullif(p->>'title',''),'นาย'), btrim(p->>'first_name'), btrim(p->>'last_name'), nullif(p->>'nickname',''),
      nullif(p->>'first_name_en',''), nullif(p->>'last_name_en',''), coalesce(nullif(p->>'nationality',''),'ไทย'), nid, nullif(p->>'passport_no',''),
      nullif(p->>'phone',''), nullif(p->>'email',''), nullif(p->>'line_id',''), nullif(p->>'address',''), nullif(p->>'emergency_name',''), nullif(p->>'emergency_phone',''),
      nullif(p->>'department',''), nullif(p->>'position',''), (p->>'hire_date')::date, coalesce((p->>'probation_days')::int, 90),
      coalesce(nullif(p->>'status',''),'probation'), nullif(p->>'birth_date','')::date, nullif(p->>'note',''),
      coalesce(nullif(p->>'pay_type',''),'monthly'), (p->>'salary')::numeric, coalesce((p->>'sso')::boolean, true),
      coalesce((p->>'auto_tax')::boolean, true), coalesce(nullif(p->>'pay_method',''),'transfer'),
      nullif(p->>'bank_name',''), nullif(p->>'bank_account_no',''), coalesce(nullif(p->>'bank_account_type',''),'savings'), nullif(p->>'bank_branch',''))
  on conflict (id) do update set code = excluded.code, title = excluded.title, first_name = excluded.first_name, last_name = excluded.last_name,
      nickname = excluded.nickname, first_name_en = excluded.first_name_en, last_name_en = excluded.last_name_en, nationality = excluded.nationality,
      national_id = excluded.national_id, passport_no = excluded.passport_no, phone = excluded.phone, email = excluded.email, line_id = excluded.line_id,
      address = excluded.address, emergency_name = excluded.emergency_name, emergency_phone = excluded.emergency_phone, department = excluded.department,
      position = excluded.position, hire_date = excluded.hire_date, probation_days = excluded.probation_days, status = excluded.status,
      birth_date = excluded.birth_date, note = excluded.note, pay_type = excluded.pay_type, salary = excluded.salary, sso = excluded.sso,
      auto_tax = excluded.auto_tax, pay_method = excluded.pay_method, bank_name = excluded.bank_name, bank_account_no = excluded.bank_account_no,
      bank_account_type = excluded.bank_account_type, bank_branch = excluded.bank_branch;
  return v;
end $$;

-- คำนวณบรรทัด: ค่าที่ไม่ส่งมา = คำนวณอัตโนมัติ (ประกันสังคม/ภาษี) · ส่งมา = ใช้ค่าที่กรอก (FA ให้แก้เองได้)
create function payroll_calc_line(r payroll_runs, e employees, l jsonb) returns payroll_lines language plpgsql stable as $$
declare x payroll_lines; s payroll_settings;
begin
  select * into s from payroll_settings;
  x.run_id := r.id; x.employee_id := e.id;
  x.rate := coalesce((l->>'rate')::numeric, e.salary);
  x.days := coalesce((l->>'days')::numeric, 0);
  x.base := case when r.pay_type = 'daily' then round(x.days * x.rate, 2) else coalesce((l->>'base')::numeric, e.salary) end;
  x.ot := coalesce((l->>'ot')::numeric, 0); x.commission := coalesce((l->>'commission')::numeric, 0);
  x.absence := coalesce((l->>'absence')::numeric, 0); x.other_deduct := coalesce((l->>'other_deduct')::numeric, 0);
  x.sso_employee := coalesce((l->>'sso_employee')::numeric, case when s.sso_enabled and e.sso then payroll_sso(x.base) else 0 end);
  x.sso_employer := x.sso_employee;
  -- ภาษีอัตโนมัติจากฐานเงินเดือนเท่านั้น (ตาม FA) · พนักงานรายวัน FA ไม่มีคำนวณอัตโนมัติ
  x.wht_401 := coalesce((l->>'wht_401')::numeric, case when e.auto_tax and r.pay_type = 'monthly' then
    greatest(payroll_wht_monthly(x.base, x.sso_employee) + payroll_wht_extra(x.base, x.sso_employee, x.ot + x.commission - x.absence), 0) else 0 end);
  x.wht_402 := coalesce((l->>'wht_402')::numeric, 0);
  if least(x.days, x.rate, x.base, x.ot, x.commission, x.absence, x.other_deduct, x.sso_employee, x.wht_401, x.wht_402) < 0 then
    raise exception 'จำนวนเงินของ % ต้องไม่ติดลบ', e.code;
  end if;
  x.net := x.base + x.ot + x.commission - x.absence - x.other_deduct - x.sso_employee - x.wht_401 - x.wht_402;
  if x.net < 0 then raise exception 'ยอดจ่ายสุทธิของ % ติดลบ', e.code; end if;
  x.slip_note := nullif(l->>'slip_note','');
  return x;
end $$;

-- JV ค้างจ่ายของรายการเงินเดือน (ยอดรวมทุกคน)
create function payroll_accrual_voucher(p_id uuid) returns uuid language plpgsql as $$
declare r payroll_runs; t record; v_lines jsonb := '[]'; per text;
begin
  select * into r from payroll_runs where id = p_id;
  select sum(base) b, sum(ot) o, sum(commission) c, sum(sso_employer) se, sum(sso_employee + sso_employer) s,
         sum(wht_401 + wht_402) w, sum(absence + other_deduct) d, sum(net) n into t from payroll_lines where run_id = p_id;
  per := to_char(r.period_to, 'MM/YYYY');
  if coalesce(t.b, 0) > 0 then v_lines := v_lines || jsonb_build_object('account','53011.01','debit',t.b); end if;
  if t.o > 0 then v_lines := v_lines || jsonb_build_object('account','53011.02','debit',t.o); end if;
  if t.c > 0 then v_lines := v_lines || jsonb_build_object('account','53011.03','debit',t.c); end if;
  if t.se > 0 then v_lines := v_lines || jsonb_build_object('account','53012.01','debit',t.se); end if;
  if t.s > 0 then v_lines := v_lines || jsonb_build_object('account','21952.01','credit',t.s); end if;
  if t.w > 0 then v_lines := v_lines || jsonb_build_object('account','27121','credit',t.w); end if;
  if t.d > 0 then v_lines := v_lines || jsonb_build_object('account','49920','credit',t.d); end if;
  if t.n > 0 then v_lines := v_lines || jsonb_build_object('account','21951.01','credit',t.n); end if;
  if jsonb_array_length(v_lines) = 0 then return null; end if;
  return post_voucher('JV', r.pay_date, 'บันทึกรายการเงินเดือนค้างจ่ายสำหรับงวด ' || per, 'PAYROLL', p_id::text, v_lines);
end $$;

create function payroll_write_lines(r payroll_runs, p_lines jsonb) returns void language plpgsql as $$
declare l jsonb; e employees; x payroll_lines; n int := 0;
begin
  delete from payroll_lines where run_id = r.id;
  for l in select * from jsonb_array_elements(coalesce(p_lines, '[]')) loop
    select * into e from employees where id = (l->>'employee_id')::uuid;
    if not found then raise exception 'ไม่พบพนักงาน'; end if;
    if e.pay_type <> r.pay_type then raise exception '% ไม่ใช่พนักงาน%', e.code, case r.pay_type when 'daily' then 'รายวัน' else 'รายเดือน' end; end if;
    if e.status = 'resigned' then raise exception '% ลาออกแล้ว', e.code; end if;
    x := payroll_calc_line(r, e, l);
    insert into payroll_lines select x.*;
    n := n + 1;
  end loop;
  if n = 0 then raise exception 'ต้องมีพนักงานอย่างน้อย 1 คน'; end if;
end $$;

-- สร้าง/แก้รายการเงินเดือน (แก้ได้เฉพาะรอดำเนินการ) → ลง JV ค้างจ่ายทันที
create function save_payroll_run(p_id uuid, h jsonb, p_lines jsonb) returns uuid language plpgsql as $$
declare r payroll_runs; v_old uuid;
begin
  perform payroll_enabled_check();
  if p_id is null then
    insert into payroll_runs(pay_type, pay_method, doc_date, period_from, period_to, pay_date, note, created_by)
    values (coalesce(nullif(h->>'pay_type',''),'monthly'), coalesce(nullif(h->>'pay_method',''),'transfer'),
            coalesce(nullif(h->>'doc_date','')::date, today_th()), (h->>'period_from')::date, (h->>'period_to')::date,
            coalesce(nullif(h->>'pay_date','')::date, today_th()), nullif(h->>'note',''), doc_event_actor())
    returning * into r;
  else
    select * into r from payroll_runs where id = p_id for update;
    if not found then raise exception 'ไม่พบรายการเงินเดือน'; end if;
    if r.status <> 'pending' then raise exception 'แก้ไขได้เฉพาะรายการที่รอดำเนินการ (จ่ายแล้วต้องรีเซ็ตการชำระก่อน)'; end if;
    v_old := r.accrual_voucher_id;
    update payroll_runs set doc_date = coalesce(nullif(h->>'doc_date','')::date, doc_date), period_from = coalesce(nullif(h->>'period_from','')::date, period_from),
        period_to = coalesce(nullif(h->>'period_to','')::date, period_to), pay_date = coalesce(nullif(h->>'pay_date','')::date, pay_date),
        note = nullif(h->>'note',''), accrual_voucher_id = null where id = p_id returning * into r;
    if v_old is not null then perform reverse_voucher(v_old); end if;
  end if;
  perform payroll_write_lines(r, p_lines);
  update payroll_runs set accrual_voucher_id = payroll_accrual_voucher(r.id) where id = r.id;
  return r.id;
end $$;

-- บันทึกการจ่าย: Dr เงินเดือนค้างจ่าย (+ค่าธรรมเนียม) / Cr เงินสด 11112 หรือบัญชีธนาคารที่ตั้งไว้
create function pay_payroll_run(p_id uuid, p_date date, p_fee numeric default 0) returns uuid language plpgsql as $$
declare r payroll_runs; n numeric; acc text; v uuid; v_lines jsonb;
begin
  select * into r from payroll_runs where id = p_id for update;
  if not found then raise exception 'ไม่พบรายการเงินเดือน'; end if;
  if r.status <> 'pending' then raise exception 'จ่ายได้เฉพาะรายการที่รอดำเนินการ'; end if;
  if coalesce(p_fee, 0) < 0 then raise exception 'ค่าธรรมเนียมต้องไม่ติดลบ'; end if;
  if r.pay_method = 'cash' and coalesce(p_fee, 0) > 0 then raise exception 'จ่ายเงินสดไม่มีค่าธรรมเนียมโอน'; end if;
  select sum(net) into n from payroll_lines where run_id = p_id;
  if r.pay_method = 'cash' then acc := '11112';
  else
    select a.code into acc from payroll_settings s join bank_accounts b on b.id = s.bank_account_id join accounts a on a.id = b.account_id;
    if acc is null then raise exception 'ยังไม่ได้ตั้งบัญชีเงินเดือน (บัญชีธนาคารที่ใช้จ่าย) ในตั้งค่าเงินเดือน'; end if;
  end if;
  v_lines := jsonb_build_array(jsonb_build_object('account','21951.01','debit',n));
  if p_fee > 0 then v_lines := v_lines || jsonb_build_object('account','53211','debit',p_fee); end if;
  v_lines := v_lines || jsonb_build_object('account',acc,'credit',n + coalesce(p_fee, 0));
  v := post_voucher('JV', coalesce(p_date, r.pay_date), 'ชำระรายการเงินเดือนสำหรับงวด ' || to_char(r.period_to, 'MM/YYYY'), 'PAYROLL_PAY', p_id::text, v_lines);
  update payroll_runs set status = 'paid', payment_voucher_id = v, paid_date = coalesce(p_date, r.pay_date), fee = coalesce(p_fee, 0) where id = p_id;
  return v;
end $$;

create function reset_payroll_payment(p_id uuid) returns void language plpgsql as $$
declare r payroll_runs;
begin
  select * into r from payroll_runs where id = p_id for update;
  if not found or r.status <> 'paid' then raise exception 'รีเซ็ตได้เฉพาะรายการที่ชำระเงินแล้ว'; end if;
  perform reverse_voucher(r.payment_voucher_id);
  update payroll_runs set status = 'pending', payment_voucher_id = null, paid_date = null, fee = 0 where id = p_id;
end $$;

create function cancel_payroll_run(p_id uuid) returns void language plpgsql as $$
declare r payroll_runs;
begin
  select * into r from payroll_runs where id = p_id for update;
  if not found then raise exception 'ไม่พบรายการเงินเดือน'; end if;
  if r.status <> 'pending' then raise exception 'ยกเลิกได้เฉพาะรายการที่รอดำเนินการ (จ่ายแล้วต้องรีเซ็ตการชำระก่อน)'; end if;
  if r.accrual_voucher_id is not null then perform reverse_voucher(r.accrual_voucher_id); end if;
  update payroll_runs set status = 'cancelled' where id = p_id;
end $$;

-- ภ.ง.ด.1 รายเดือน: เงินได้ 40(1)/40(2) ที่จ่ายจริง (เฉพาะรายการเงินเดือนที่ชำระแล้ว ตามวันที่ชำระ) รวมต่อพนักงาน
create function pnd1_lines(p_from date, p_to date) returns table(employee_id uuid, code text, national_id text, title text, first_name text, last_name text,
    address text, paid_date date, income numeric, wht_401 numeric, wht_402 numeric) language sql stable as $$
  select e.id, e.code, e.national_id, e.title, e.first_name, e.last_name, e.address, max(r.paid_date),
         sum(l.base + l.ot + l.commission - l.absence), sum(l.wht_401), sum(l.wht_402)
  from payroll_lines l join payroll_runs r on r.id = l.run_id join employees e on e.id = l.employee_id
  where r.status = 'paid' and r.paid_date between p_from and p_to
  group by e.id order by e.code
$$;
