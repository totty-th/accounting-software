-- M31 ปิดงบบัญชีรายได้และค่าใช้จ่าย (REA FlowAccount 1-11-2026)
-- เลือกรอบเป็นช่วงวันที่ใดก็ได้ (เดือน/ปี/กำหนดเอง) ปิดได้หลายครั้งต่อปี · ห้ามรอบทับกับเอกสารปิดเดิมที่ยังไม่ลบ
-- สถานะ: pending (รอดำเนินการ = บันทึกร่าง) → approved (อนุมัติ = ลงใบสำคัญ CP) · ลบเอกสารที่อนุมัติแล้ว = กลับรายการ -R
-- บัญชีสำหรับบันทึกผลต่าง = บัญชีหมวดทุน (เลือกได้ ค่าตั้งต้น 34200 ถ้ามี มิฉะนั้นบัญชีกำไรสะสมของระบบ)
create table period_closings (
  id uuid primary key default gen_random_uuid(),
  doc_no text not null unique,
  closing_date date not null,
  period_from date not null,
  period_to date not null,
  equity_account text not null references accounts(code),
  status text not null default 'pending' check (status in ('pending','approved')),
  voucher_id uuid references journal_vouchers(id),
  total_revenue numeric(18,2) not null default 0,
  total_expense numeric(18,2) not null default 0,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  deleted_at timestamptz,
  check (period_from <= period_to)
);

-- ปีที่ปิดไว้ก่อนหน้า (year_closes) → เอกสารที่อนุมัติแล้ว
insert into period_closings(doc_no, closing_date, period_from, period_to, equity_account, status, voucher_id, total_revenue, total_expense, approved_at)
select 'CRE' || to_char(v.voucher_date, 'YYYYMMDD') || lpad((row_number() over (partition by v.voucher_date order by y.year))::text, 4, '0'),
       v.voucher_date, make_date(y.year, 1, 1), make_date(y.year, 12, 31), sys_account('retained_earnings'), 'approved', y.voucher_id,
       coalesce((select sum(l.debit - l.credit) from journal_lines l join accounts a on a.id = l.account_id where l.voucher_id = v.id and a.type = 'revenue'), 0),
       coalesce((select sum(l.credit - l.debit) from journal_lines l join accounts a on a.id = l.account_id where l.voucher_id = v.id and a.type = 'expense'), 0),
       y.created_at
  from year_closes y join journal_vouchers v on v.id = y.voucher_id where y.status = 'closed';

create function closing_th_date(d date) returns text language sql immutable as $$
  select to_char(d, 'DD') || ' ' || (array['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'])[extract(month from d)::int] || ' ' || to_char(d, 'YYYY')
$$;

create function closing_default_account() returns text language sql stable as $$
  select coalesce((select code from accounts where code = '34200' and type = 'equity'), sys_account('retained_earnings'))
$$;

-- ตรวจรอบ (ใช้ทั้งสร้างและแก้ไข): คืนข้อความผิดพลาดหรือ null
create function closing_check(p_from date, p_to date, p_equity text, p_self uuid default null) returns void language plpgsql as $$
declare c period_closings;
begin
  if p_from is null or p_to is null then raise exception 'กรุณาเลือกช่วงเวลา'; end if;
  if p_from > p_to then raise exception 'วันที่เริ่มต้นต้องไม่เกินวันที่สิ้นสุด'; end if;
  if not exists (select 1 from accounts where code = p_equity and type = 'equity') then raise exception 'บัญชีสำหรับบันทึกผลต่างต้องเป็นบัญชีหมวดทุน'; end if;
  select * into c from period_closings where deleted_at is null and (p_self is null or id <> p_self) and period_from <= p_to and period_to >= p_from order by created_at limit 1;
  if found then raise exception 'ไม่สามารถดำเนินการต่อได้ เนื่องจากมีการปิดบัญชีรายได้และค่าใช้จ่าย กรุณาอัปเดตข้อมูลที่เอกสาร % หรือใช้ช่วงวันที่อื่นเพื่อปิดบัญชี', c.doc_no; end if;
end $$;

create function closing_totals(p_from date, p_to date) returns table (revenue numeric, expense numeric, lines int) language sql stable as $$
  select coalesce(sum(case when section = 'revenue' then amount end), 0), coalesce(sum(case when section <> 'revenue' then amount end), 0), count(*)::int
    from income_statement(p_from, p_to)
$$;

create function create_period_closing(p_date date, p_from date, p_to date, p_equity text default null, p_approve boolean default false)
returns uuid language plpgsql as $$
declare v_eq text := coalesce(p_equity, closing_default_account()); v_id uuid := gen_random_uuid(); t record;
begin
  if p_date is null then raise exception 'กรุณาระบุวันที่ปิดบัญชี'; end if;
  perform closing_check(p_from, p_to, v_eq);
  select * into t from closing_totals(p_from, p_to);
  if t.lines = 0 then raise exception 'ช่วงเวลาที่เลือกไม่มีรายการรายได้/ค่าใช้จ่ายให้ปิดบัญชี'; end if;
  insert into period_closings(id, doc_no, closing_date, period_from, period_to, equity_account, total_revenue, total_expense)
  values (v_id, next_doc_no('CRE', p_date, true), p_date, p_from, p_to, v_eq, t.revenue, t.expense);
  if p_approve then perform approve_period_closing(v_id); end if;
  return v_id;
end $$;

-- แก้ไขได้เฉพาะที่ยังรอดำเนินการ
create function update_period_closing(p_id uuid, p_date date, p_from date, p_to date, p_equity text) returns void language plpgsql as $$
declare c period_closings; t record;
begin
  select * into c from period_closings where id = p_id and deleted_at is null; if not found then raise exception 'ไม่พบเอกสารปิดบัญชี'; end if;
  if c.status <> 'pending' then raise exception 'เอกสารที่อนุมัติแล้วแก้ไขไม่ได้ ให้ลบ (กลับรายการ) แล้วสร้างใหม่'; end if;
  perform closing_check(p_from, p_to, p_equity, p_id);
  select * into t from closing_totals(p_from, p_to);
  if t.lines = 0 then raise exception 'ช่วงเวลาที่เลือกไม่มีรายการรายได้/ค่าใช้จ่ายให้ปิดบัญชี'; end if;
  update period_closings set closing_date = p_date, period_from = p_from, period_to = p_to, equity_account = p_equity, total_revenue = t.revenue, total_expense = t.expense where id = p_id;
end $$;

create function approve_period_closing(p_id uuid) returns uuid language plpgsql as $$
declare c period_closings; r record; v_lines jsonb := '[]'::jsonb; v_net numeric := 0; v uuid; t record;
begin
  select * into c from period_closings where id = p_id and deleted_at is null for update; if not found then raise exception 'ไม่พบเอกสารปิดบัญชี'; end if;
  if c.status = 'approved' then raise exception 'เอกสารนี้อนุมัติแล้ว'; end if;
  perform closing_check(c.period_from, c.period_to, c.equity_account, c.id);
  for r in select * from income_statement(c.period_from, c.period_to) loop
    if r.section = 'revenue' then
      v_lines := v_lines || jsonb_build_object('account', r.code, case when r.amount > 0 then 'debit' else 'credit' end, abs(r.amount)); v_net := v_net + r.amount;
    else
      v_lines := v_lines || jsonb_build_object('account', r.code, case when r.amount > 0 then 'credit' else 'debit' end, abs(r.amount)); v_net := v_net - r.amount;
    end if;
  end loop;
  if jsonb_array_length(v_lines) = 0 then raise exception 'ช่วงเวลาที่เลือกไม่มีรายการรายได้/ค่าใช้จ่ายให้ปิดบัญชี'; end if;
  if v_net <> 0 then v_lines := v_lines || jsonb_build_object('account', c.equity_account, case when v_net > 0 then 'credit' else 'debit' end, abs(v_net)); end if;
  v := post_voucher('CP', c.closing_date, 'บันทึกปิดรายได้และค่าใช้จ่ายงวด ' || closing_th_date(c.period_from) || ' - ' || closing_th_date(c.period_to), 'CLOSE', c.doc_no, v_lines);
  select * into t from closing_totals(c.period_from, c.period_to);
  update period_closings set status = 'approved', voucher_id = v, approved_at = now(), total_revenue = t.revenue, total_expense = t.expense where id = p_id;
  return v;
end $$;

-- ลบ: ร่าง = ลบทิ้ง · อนุมัติแล้ว = กลับรายการ -R แล้วเลิกใช้เอกสาร (รอบนั้นปิดใหม่ได้)
create function delete_period_closing(p_id uuid) returns void language plpgsql as $$
declare c period_closings;
begin
  select * into c from period_closings where id = p_id and deleted_at is null for update; if not found then raise exception 'ไม่พบเอกสารปิดบัญชี'; end if;
  if c.status = 'approved' then
    perform reverse_voucher(c.voucher_id);
    update year_closes set status = 'reset' where voucher_id = c.voucher_id and status = 'closed';
  end if;
  update period_closings set deleted_at = now() where id = p_id;
end $$;

-- ปิดสิ้นปี (เดิม) ใช้ฟังก์ชันใหม่: ปี 1 ม.ค.–31 ธ.ค. ลงวันที่ 31 ธ.ค. บัญชีกำไรสะสมของระบบ
create or replace function close_year(p_year int) returns uuid language plpgsql as $$
declare v_id uuid; v uuid;
begin
  if exists (select 1 from year_closes where year = p_year and status = 'closed') then raise exception 'ปี % ปิดงวดแล้ว', p_year; end if;
  v_id := create_period_closing(make_date(p_year, 12, 31), make_date(p_year, 1, 1), make_date(p_year, 12, 31), sys_account('retained_earnings'), true);
  select voucher_id into v from period_closings where id = v_id;
  insert into year_closes(year, voucher_id) values (p_year, v);
  return v;
end $$;

create or replace function reset_year_close(p_year int) returns void language plpgsql as $$
declare c year_closes; p uuid;
begin
  select * into c from year_closes where year = p_year and status = 'closed';
  if not found then raise exception 'ปี % ยังไม่ได้ปิดงวด', p_year; end if;
  select id into p from period_closings where voucher_id = c.voucher_id and deleted_at is null;
  if p is not null then perform delete_period_closing(p); else perform reverse_voucher(c.voucher_id); end if;
  update year_closes set status = 'reset' where year = p_year and status = 'closed';
end $$;
