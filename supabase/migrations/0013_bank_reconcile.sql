-- M13 บัญชีธนาคาร + รายการเดินบัญชี (statement) + กระทบยอด
-- ตรรกะตามต้นแบบ (ดู docs/spec.md "REA การกระทบยอดธนาคาร"):
--  * บัญชีธนาคารเป็นบัญชีย่อยของ 11122.xx ในผังบัญชี
--  * statement นำเข้าเป็นชุด (batch) ต่อไฟล์ ยอดเงินเข้าเป็นบวก เงินออกเป็นลบ
--  * จับคู่ N ต่อ N ได้เมื่อผลรวมสองฝั่งเท่ากัน ปลดคู่ใดคู่หนึ่งปลดทั้งกลุ่ม
--  * ผลรวมไม่เท่ากัน → สร้าง JV ปิดผลต่างให้แล้วจับคู่ในขั้นเดียว (bank_match_with_diff)
--  * ใบสำคัญที่จับคู่แล้วกลับรายการไม่ได้ จนกว่าจะยกเลิกจับคู่
--  * ล็อกงวดตรวจที่วันที่ของใบสำคัญที่จะลง (post_voucher / reverse_voucher) ไม่ใช่วันที่ในรายการธนาคาร

create table bank_accounts (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null unique references accounts(id),
  bank_name    text not null check (length(btrim(bank_name)) > 0),
  account_no   text not null check (length(btrim(account_no)) > 0),
  account_name text,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  unique (bank_name, account_no)
);

create table bank_statement_batches (
  id              uuid primary key default gen_random_uuid(),
  bank_account_id uuid not null references bank_accounts(id),
  file_name       text,
  created_at      timestamptz not null default now()
);

create table bank_reconcile_groups (
  id              uuid primary key default gen_random_uuid(),
  bank_account_id uuid not null references bank_accounts(id),
  diff_voucher_id uuid references journal_vouchers(id),
  created_at      timestamptz not null default now()
);

create table bank_statement_lines (
  id              uuid primary key default gen_random_uuid(),
  batch_id        uuid not null references bank_statement_batches(id),
  bank_account_id uuid not null references bank_accounts(id),
  line_no         int  not null,
  line_date       date not null,
  description     text,
  amount          numeric(18,2) not null check (amount <> 0),   -- เงินเข้า +, เงินออก −
  balance         numeric(18,2),
  group_id        uuid references bank_reconcile_groups(id),
  unique (batch_id, line_no)
);
create index on bank_statement_lines (bank_account_id, line_date);
create index on bank_statement_lines (group_id);

create table bank_reconcile_items (
  journal_line_id uuid primary key references journal_lines(id),
  group_id        uuid not null references bank_reconcile_groups(id)
);
create index on bank_reconcile_items (group_id);

-- ---------- ตั้งบัญชีธนาคาร (สร้างบัญชีย่อย 11122.nn ให้) ----------
create function bank_account_create(p_bank text, p_no text, p_name text default null,
                                    p_account_code text default null) returns uuid
language plpgsql as $$
declare v_code text := p_account_code; v_n int; v_acc uuid; v_id uuid := gen_random_uuid();
begin
  if v_code is null then
    select coalesce(max(substring(code from '^11122\.(\d+)$')::int), 0) + 1 into v_n
      from accounts where code ~ '^11122\.\d+$';
    v_code := '11122.' || lpad(v_n::text, 2, '0');
    insert into accounts(code, name, type) values (v_code, p_bank || ' ' || p_no, 'asset')
    returning id into v_acc;
  else
    select id into v_acc from accounts where code = v_code and is_active and type = 'asset';
    if v_acc is null then raise exception 'ไม่พบบัญชีสินทรัพย์ %', v_code; end if;
  end if;
  insert into bank_accounts(id, account_id, bank_name, account_no, account_name)
  values (v_id, v_acc, p_bank, p_no, p_name);
  return v_id;
end $$;

-- ---------- นำเข้า statement ----------
-- p_rows = [{"date":"2026-10-21","description":"ดอกเบี้ยรับ","deposit":500,"withdrawal":0,"balance":3675}, ...]
create function bank_statement_import(p_bank uuid, p_file text, p_rows jsonb) returns uuid
language plpgsql as $$
declare v_batch uuid := gen_random_uuid(); r jsonb; n int := 0; d numeric; w numeric;
begin
  if not exists (select 1 from bank_accounts where id = p_bank and is_active) then
    raise exception 'ไม่พบบัญชีธนาคาร';
  end if;
  if p_rows is null or jsonb_array_length(p_rows) = 0 then
    raise exception 'ไม่มีรายการให้นำเข้า';
  end if;
  insert into bank_statement_batches(id, bank_account_id, file_name) values (v_batch, p_bank, p_file);
  for r in select * from jsonb_array_elements(p_rows) loop
    d := coalesce(nullif(r->>'deposit','')::numeric, 0);
    w := coalesce(nullif(r->>'withdrawal','')::numeric, 0);
    n := n + 1;
    if d < 0 or w < 0 then raise exception 'แถว %: จำนวนเงินติดลบไม่ได้', n; end if;
    if (d > 0) = (w > 0) then raise exception 'แถว %: ต้องมีเงินเข้าหรือเงินออกอย่างใดอย่างหนึ่ง', n; end if;
    insert into bank_statement_lines(batch_id, bank_account_id, line_no, line_date, description, amount, balance)
    values (v_batch, p_bank, n, (r->>'date')::date, r->>'description', d - w, nullif(r->>'balance','')::numeric);
  end loop;
  return v_batch;
end $$;

-- ---------- รายการบัญชีฝั่ง FlowAccount-เทียบเท่า: บรรทัดสมุดรายวันของบัญชีธนาคารนั้น ----------
-- ตัดใบสำคัญที่ถูกกลับรายการและใบกลับรายการออก (หักล้างกันเป็นศูนย์อยู่แล้ว)
create function bank_book_items(p_bank uuid)
returns table (journal_line_id uuid, voucher_id uuid, voucher_no text, voucher_date date,
               memo text, amount numeric, group_id uuid)
language sql stable as $$
  select l.id, v.id, v.voucher_no, v.voucher_date, v.memo, l.debit - l.credit, i.group_id
    from bank_accounts b
    join journal_lines l on l.account_id = b.account_id
    join journal_vouchers v on v.id = l.voucher_id
    left join bank_reconcile_items i on i.journal_line_id = l.id
   where b.id = p_bank
     and v.reverses_id is null
     and not exists (select 1 from journal_vouchers x where x.reverses_id = v.id)
   order by v.voucher_date, v.voucher_no, l.line_no;
$$;

-- ---------- จับคู่ (ผลรวมต้องเท่ากัน) ----------
create function bank_match(p_lines uuid[], p_items uuid[]) returns uuid
language plpgsql as $$
declare v_bank uuid; v_n int; v_sl numeric; v_si numeric; v_g uuid := gen_random_uuid();
begin
  if coalesce(array_length(p_lines,1),0) = 0 or coalesce(array_length(p_items,1),0) = 0 then
    raise exception 'ต้องเลือกทั้งรายการธนาคารและเอกสารอย่างน้อยฝั่งละ 1 รายการ';
  end if;
  select count(distinct bank_account_id), min(bank_account_id::text)::uuid, coalesce(sum(amount),0)
    into v_n, v_bank, v_sl
    from bank_statement_lines where id = any(p_lines);
  if (select count(*) from bank_statement_lines where id = any(p_lines)) <> array_length(p_lines,1) then
    raise exception 'ไม่พบรายการธนาคารบางรายการ';
  end if;
  if v_n <> 1 then raise exception 'รายการธนาคารต้องอยู่บัญชีเดียวกัน'; end if;
  if exists (select 1 from bank_statement_lines where id = any(p_lines) and group_id is not null) then
    raise exception 'รายการธนาคารบางรายการจับคู่แล้ว';
  end if;
  select coalesce(sum(l.debit - l.credit),0) into v_si
    from journal_lines l join bank_accounts b on b.account_id = l.account_id
   where l.id = any(p_items) and b.id = v_bank;
  if (select count(*) from journal_lines l join bank_accounts b on b.account_id = l.account_id
       where l.id = any(p_items) and b.id = v_bank) <> array_length(p_items,1) then
    raise exception 'เอกสารบางรายการไม่ใช่รายการของบัญชีธนาคารนี้';
  end if;
  if exists (select 1 from bank_reconcile_items where journal_line_id = any(p_items)) then
    raise exception 'เอกสารบางรายการจับคู่แล้ว';
  end if;
  if v_sl <> v_si then
    raise exception 'ผลรวมไม่เท่ากัน: ธนาคาร % เอกสาร % ผลต่าง %', v_sl, v_si, v_sl - v_si;
  end if;
  insert into bank_reconcile_groups(id, bank_account_id) values (v_g, v_bank);
  update bank_statement_lines set group_id = v_g where id = any(p_lines);
  insert into bank_reconcile_items(journal_line_id, group_id) select unnest(p_items), v_g;
  return v_g;
end $$;

-- ---------- จับคู่แบบมีผลต่าง: สร้าง JV ปิดผลต่าง (ธนาคาร vs บัญชีที่เลือก) แล้วจับคู่ ----------
-- ธนาคารมากกว่าเอกสาร (ผลต่างบวก): Dr ธนาคาร / Cr p_account · น้อยกว่า: Dr p_account / Cr ธนาคาร
-- วันที่เริ่มต้น = วันที่ล่าสุดของรายการธนาคารที่เลือก
create function bank_match_with_diff(p_lines uuid[], p_items uuid[], p_account text,
                                     p_memo text, p_date date default null) returns uuid
language plpgsql as $$
declare v_bank uuid; v_acc text; v_sl numeric; v_si numeric; v_diff numeric; v_date date;
        v_v uuid; v_line uuid; v_g uuid;
begin
  if coalesce(array_length(p_lines,1),0) = 0 or coalesce(array_length(p_items,1),0) = 0 then
    raise exception 'ต้องเลือกทั้งรายการธนาคารและเอกสารอย่างน้อยฝั่งละ 1 รายการ';
  end if;
  select min(bank_account_id::text)::uuid, coalesce(sum(amount),0), max(line_date)
    into v_bank, v_sl, v_date from bank_statement_lines where id = any(p_lines);
  if v_bank is null then raise exception 'ไม่พบรายการธนาคาร'; end if;
  select a.code into v_acc from bank_accounts b join accounts a on a.id = b.account_id where b.id = v_bank;
  select coalesce(sum(l.debit - l.credit),0) into v_si
    from journal_lines l join bank_accounts b on b.account_id = l.account_id
   where l.id = any(p_items) and b.id = v_bank;
  v_diff := v_sl - v_si;
  if v_diff = 0 then raise exception 'ผลต่างเป็น 0 ใช้ bank_match ได้เลย'; end if;
  if p_memo is null or length(btrim(p_memo)) = 0 then raise exception 'ต้องระบุคำอธิบายรายการ'; end if;
  v_date := coalesce(p_date, v_date);
  if v_diff > 0 then
    v_v := post_voucher('JV', v_date, p_memo, 'bank_diff', null,
      jsonb_build_array(jsonb_build_object('account', v_acc, 'debit', v_diff),
                        jsonb_build_object('account', p_account, 'credit', v_diff)));
  else
    v_v := post_voucher('JV', v_date, p_memo, 'bank_diff', null,
      jsonb_build_array(jsonb_build_object('account', p_account, 'debit', -v_diff),
                        jsonb_build_object('account', v_acc, 'credit', -v_diff)));
  end if;
  select l.id into v_line from journal_lines l join bank_accounts b on b.account_id = l.account_id
   where l.voucher_id = v_v and b.id = v_bank;
  v_g := bank_match(p_lines, p_items || v_line);
  update bank_reconcile_groups set diff_voucher_id = v_v where id = v_g;
  return v_g;
end $$;

-- ---------- ยกเลิกการจับคู่ (ปลดทั้งกลุ่ม) ----------
-- ถ้ากลุ่มมี JV ผลต่าง ต้องระบุ p_diff_action: 'cancel' = กลับรายการ JV นั้น · 'keep' = คงไว้ให้จับคู่ใหม่
create function bank_unmatch(p_line uuid, p_diff_action text default null) returns void
language plpgsql as $$
declare v_g uuid; v_diff uuid;
begin
  select group_id into v_g from bank_statement_lines where id = p_line;
  if v_g is null then raise exception 'รายการนี้ยังไม่ได้จับคู่'; end if;
  select diff_voucher_id into v_diff from bank_reconcile_groups where id = v_g;
  if v_diff is not null and coalesce(p_diff_action,'') not in ('cancel','keep') then
    raise exception 'DIFF_ACTION_REQUIRED: กลุ่มนี้มี JV ผลต่าง ต้องเลือก cancel หรือ keep';
  end if;
  update bank_statement_lines set group_id = null where group_id = v_g;
  delete from bank_reconcile_items where group_id = v_g;
  delete from bank_reconcile_groups where id = v_g;
  if v_diff is not null and p_diff_action = 'cancel' then
    perform reverse_voucher(v_diff);   -- ล็อกงวดตรวจที่นี่ ถ้าล้มทั้งธุรกรรมย้อนกลับ
  end if;
end $$;

-- ---------- ใบสำคัญที่จับคู่แล้วกลับรายการไม่ได้ ----------
create or replace function reverse_voucher(p_voucher_id uuid, p_date date default null) returns uuid
language plpgsql as $$
declare o journal_vouchers; v_id uuid := gen_random_uuid(); v_date date;
begin
  select * into o from journal_vouchers where id = p_voucher_id;
  if not found then raise exception 'ไม่พบใบสำคัญ'; end if;
  if o.reverses_id is not null then raise exception 'ใบกลับรายการไม่สามารถกลับรายการซ้ำได้'; end if;
  if exists (select 1 from journal_vouchers where reverses_id = o.id) then
    raise exception 'ใบสำคัญ % ถูกกลับรายการแล้ว', o.voucher_no;
  end if;
  if exists (select 1 from bank_reconcile_items i join journal_lines l on l.id = i.journal_line_id
              where l.voucher_id = o.id) then
    raise exception 'RECONCILED: ใบสำคัญ % กระทบยอดธนาคารแล้ว ต้องยกเลิกการจับคู่ก่อน', o.voucher_no;
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

-- ---------- สรุปหัวหน้ากระทบยอด ----------
-- bank_balance = คงเหลือของรายการล่าสุดตามวันที่ (ถ้าไม่มีคอลัมน์คงเหลือใช้ผลรวม)
-- book_matched = ยอดสมุดบัญชีเฉพาะที่จับคู่แล้ว · diff = bank_balance − book_matched (ตามต้นแบบ)
create function bank_reconcile_status(p_bank uuid, p_batch uuid default null)
returns table (total_lines int, matched_lines int, bank_balance numeric, book_matched numeric,
               book_all numeric, diff numeric)
language sql stable as $$
  with s as (
    select * from bank_statement_lines
     where bank_account_id = p_bank and (p_batch is null or batch_id = p_batch)
  ), b as (
    select coalesce((select balance from s where balance is not null
                      order by line_date desc, line_no desc limit 1),
                    (select coalesce(sum(amount),0) from s)) as bal
  ), m as (
    select coalesce(sum(amount),0) as amt from bank_book_items(p_bank) where group_id is not null
  ), a as (
    select coalesce(sum(amount),0) as amt from bank_book_items(p_bank)
  )
  select (select count(*)::int from s), (select count(*)::int from s where group_id is not null),
         b.bal, m.amt, a.amt, b.bal - m.amt
    from b, m, a;
$$;

-- ---------- โอนเงินระหว่างบัญชี: Dr ปลายทาง / Cr ต้นทาง · ค่าธรรมเนียมจ่ายจากต้นทาง ----------
create function bank_transfer(p_from text, p_to text, p_date date, p_amount numeric,
                              p_fee numeric default 0, p_fee_account text default '53211',
                              p_memo text default null) returns uuid
language plpgsql as $$
declare v_lines jsonb;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'จำนวนเงินต้องมากกว่า 0'; end if;
  if p_from = p_to then raise exception 'บัญชีต้นทางและปลายทางต้องต่างกัน'; end if;
  v_lines := jsonb_build_array(
    jsonb_build_object('account', p_to,   'debit',  p_amount),
    jsonb_build_object('account', p_from, 'credit', p_amount));
  if coalesce(p_fee,0) > 0 then
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object('account', p_fee_account, 'debit',  p_fee),
      jsonb_build_object('account', p_from,        'credit', p_fee));
  end if;
  return post_voucher('JV', p_date, coalesce(p_memo, 'โอนเงินระหว่างบัญชี'), 'bank_transfer', null, v_lines);
end $$;
