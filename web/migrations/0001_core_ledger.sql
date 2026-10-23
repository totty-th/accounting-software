create table accounts (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique,
  name       text not null,
  type       text not null check (type in ('asset','liability','equity','revenue','expense')),
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);
create table doc_sequences (
  prefix  text not null,
  bucket  date not null,
  last_no int  not null default 0,
  primary key (prefix, bucket)
);
create function next_doc_no(p_prefix text, p_date date, p_daily boolean default false)
returns text language plpgsql as $$
declare v_bucket date := case when p_daily then p_date else date '0001-01-01' end;
        v_no int;
begin
  insert into doc_sequences(prefix, bucket, last_no) values (p_prefix, v_bucket, 1)
  on conflict (prefix, bucket) do update set last_no = doc_sequences.last_no + 1
  returning last_no into v_no;
  if p_daily then
    return p_prefix || to_char(p_date, 'YYYYMMDD') || lpad(v_no::text, 4, '0');
  end if;
  return p_prefix || lpad(v_no::text, 4, '0');
end $$;
create table period_locks (
  id          uuid primary key default gen_random_uuid(),
  date_from   date not null,
  date_to     date not null,
  reason      text not null check (length(btrim(reason)) > 0),
  created_at  timestamptz not null default now(),
  released_at timestamptz,
  check (date_to >= date_from)
);
create table journal_vouchers (
  id          uuid primary key default gen_random_uuid(),
  voucher_type text not null check (voucher_type in ('SV','RV','UV','PV','JV','CP')),
  voucher_no  text not null unique,
  voucher_date date not null,
  memo        text,
  source_type text,
  source_id   text,
  reverses_id uuid unique references journal_vouchers(id),
  created_at  timestamptz not null default now()
);
create index on journal_vouchers (voucher_date);
create index on journal_vouchers (source_type, source_id);
create table journal_lines (
  id         uuid primary key default gen_random_uuid(),
  voucher_id uuid not null references journal_vouchers(id),
  line_no    int  not null,
  account_id uuid not null references accounts(id),
  debit      numeric(18,2) not null default 0 check (debit  >= 0),
  credit     numeric(18,2) not null default 0 check (credit >= 0),
  check ((debit > 0 and credit = 0) or (credit > 0 and debit = 0)),
  unique (voucher_id, line_no)
);
create index on journal_lines (account_id);
create function forbid_change() returns trigger language plpgsql as $$
begin raise exception 'รายการบัญชีแก้ไขหรือลบไม่ได้ ให้ใช้ใบกลับรายการ (-R)'; end $$;
create trigger journal_vouchers_immutable before update or delete on journal_vouchers
  for each row execute function forbid_change();
create trigger journal_lines_immutable before update or delete on journal_lines
  for each row execute function forbid_change();
create function check_voucher_balanced() returns trigger language plpgsql as $$
declare v_dr numeric; v_cr numeric;
begin
  select coalesce(sum(debit),0), coalesce(sum(credit),0) into v_dr, v_cr
    from journal_lines where voucher_id = new.voucher_id;
  if v_dr <> v_cr then
    raise exception 'เดบิต (%) ไม่เท่ากับเครดิต (%)', v_dr, v_cr;
  end if;
  return null;
end $$;
create constraint trigger journal_lines_balanced after insert on journal_lines
  deferrable initially deferred for each row execute function check_voucher_balanced();
create function assert_period_open(p_date date) returns void language plpgsql as $$
declare l period_locks;
begin
  select * into l from period_locks
   where released_at is null and p_date between date_from and date_to
   order by created_at limit 1;
  if found then
    raise exception 'PERIOD_LOCKED: งวดบัญชีถูกล็อกตั้งแต่ % ถึง % กรุณาตรวจสอบวันที่หรือติดต่อผู้มีสิทธิ์ตั้งค่า',
      to_char(l.date_from,'DD-MM-YYYY'), to_char(l.date_to,'DD-MM-YYYY');
  end if;
end $$;
create function today_th() returns date language sql stable as $$
  select (now() at time zone 'Asia/Bangkok')::date;
$$;
create function lock_period(p_from date, p_to date, p_reason text) returns uuid
language plpgsql as $$
declare v_id uuid;
begin
  if p_to > today_th() - 1 then
    raise exception 'ล็อกงวดได้ถึงเมื่อวานเท่านั้น';
  end if;
  insert into period_locks(date_from, date_to, reason) values (p_from, p_to, p_reason)
  returning id into v_id;
  return v_id;
end $$;
create function release_period_lock(p_id uuid) returns void language sql as $$
  update period_locks set released_at = now() where id = p_id and released_at is null;
$$;
create function post_voucher(
  p_type text, p_date date, p_memo text, p_source_type text, p_source_id text, p_lines jsonb
) returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid(); v_no text; l jsonb; n int := 0; v_acc uuid;
        v_dr numeric := 0; v_cr numeric := 0; d numeric; c numeric;
begin
  if p_lines is null or jsonb_array_length(p_lines) < 2 then
    raise exception 'ใบสำคัญต้องมีอย่างน้อย 2 รายการ';
  end if;
  perform assert_period_open(p_date);
  v_no := next_doc_no(p_type, p_date, false);
  insert into journal_vouchers(id, voucher_type, voucher_no, voucher_date, memo, source_type, source_id)
  values (v_id, p_type, v_no, p_date, p_memo, p_source_type, p_source_id);
  for l in select * from jsonb_array_elements(p_lines) loop
    select id into v_acc from accounts where code = l->>'account' and is_active;
    if v_acc is null then raise exception 'ไม่พบบัญชี %', l->>'account'; end if;
    d := coalesce((l->>'debit')::numeric, 0);  c := coalesce((l->>'credit')::numeric, 0);
    v_dr := v_dr + d; v_cr := v_cr + c; n := n + 1;
    insert into journal_lines(voucher_id, line_no, account_id, debit, credit) values (v_id, n, v_acc, d, c);
  end loop;
  if v_dr <> v_cr then
    raise exception 'เดบิต (%) ไม่เท่ากับเครดิต (%)', v_dr, v_cr;
  end if;
  return v_id;
end $$;
create function reverse_voucher(p_voucher_id uuid, p_date date default null) returns uuid
language plpgsql as $$
declare o journal_vouchers; v_id uuid := gen_random_uuid(); v_date date;
begin
  select * into o from journal_vouchers where id = p_voucher_id;
  if not found then raise exception 'ไม่พบใบสำคัญ'; end if;
  if o.reverses_id is not null then raise exception 'ใบกลับรายการไม่สามารถกลับรายการซ้ำได้'; end if;
  if exists (select 1 from journal_vouchers where reverses_id = o.id) then
    raise exception 'ใบสำคัญ % ถูกกลับรายการแล้ว', o.voucher_no;
  end if;
  v_date := coalesce(p_date, o.voucher_date);
  perform assert_period_open(v_date);
  insert into journal_vouchers(id, voucher_type, voucher_no, voucher_date, memo, source_type, source_id, reverses_id)
  values (v_id, o.voucher_type, o.voucher_no || '-R', v_date, 'กลับรายการ ' || o.voucher_no,
          o.source_type, o.source_id, o.id);
  insert into journal_lines(voucher_id, line_no, account_id, debit, credit)
  select v_id, line_no, account_id, credit, debit from journal_lines where voucher_id = o.id;
  return v_id;
end $$;
create function trial_balance(p_from date, p_to date, p_include_zero boolean default false)
returns table (code text, name text, opening numeric, period_dr numeric, period_cr numeric, closing numeric)
language sql stable as $$
  select a.code, a.name,
         coalesce(sum(case when v.voucher_date <  p_from then l.debit - l.credit end),0) as opening,
         coalesce(sum(case when v.voucher_date between p_from and p_to then l.debit  end),0) as period_dr,
         coalesce(sum(case when v.voucher_date between p_from and p_to then l.credit end),0) as period_cr,
         coalesce(sum(case when v.voucher_date <= p_to then l.debit - l.credit end),0) as closing
    from accounts a
    left join journal_lines l on l.account_id = a.id
    left join journal_vouchers v on v.id = l.voucher_id
   group by a.code, a.name
  having p_include_zero or
         coalesce(sum(case when v.voucher_date <= p_to then l.debit + l.credit end),0) <> 0
   order by a.code;
$$;
