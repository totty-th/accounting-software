create table pp30_filings (
  id           uuid primary key default gen_random_uuid(),
  period_month date not null,                 -- วันที่ 1 ของเดือน
  status       text not null default 'filed' check (status in ('filed','deleted')),
  output_vat   numeric(18,2) not null,
  input_vat    numeric(18,2) not null,
  result       text not null check (result in ('payable','refund','zero')),
  amount       numeric(18,2) not null,
  uv_voucher_id uuid references journal_vouchers(id),
  jv_voucher_id uuid references journal_vouchers(id),
  pv_voucher_id uuid references journal_vouchers(id),
  paid_date    date,
  refund_recorded boolean not null default false,
  created_at   timestamptz not null default now()
);
create unique index pp30_one_active_per_month on pp30_filings (period_month) where status = 'filed';
create function file_pp30(p_month date) returns uuid language plpgsql as $$
declare m_start date := date_trunc('month', p_month)::date; m_end date;
        v_out numeric; v_in numeric; v_id uuid := gen_random_uuid(); v_res text; v_amt numeric;
        v_uv uuid; v_jv uuid; v_lines jsonb;
begin
  m_end := (m_start + interval '1 month' - interval '1 day')::date;
  if exists (select 1 from pp30_filings where period_month = m_start and status = 'filed') then
    raise exception 'เดือนนี้มีแบบ ภ.พ.30 ที่ยื่นแล้ว ต้องลบแบบเดิมก่อน';
  end if;
  select coalesce(sum(l.credit - l.debit), 0) into v_out
    from journal_lines l join journal_vouchers v on v.id = l.voucher_id join accounts a on a.id = l.account_id
   where a.code = '27111' and v.voucher_date between m_start and m_end and v.source_type is distinct from 'PP30';
  select coalesce(sum(l.debit - l.credit), 0) into v_in
    from journal_lines l join journal_vouchers v on v.id = l.voucher_id join accounts a on a.id = l.account_id
   where a.code = '17113' and v.voucher_date between m_start and m_end and v.source_type is distinct from 'PP30';
  if v_out < 0 or v_in < 0 then raise exception 'ยอดภาษีติดลบ กรุณาตรวจสอบรายการเดือนนี้'; end if;
  v_res := case when v_out > v_in then 'payable' when v_in > v_out then 'refund' else 'zero' end;
  v_amt := abs(v_out - v_in);
  insert into pp30_filings(id, period_month, output_vat, input_vat, result, amount)
  values (v_id, m_start, v_out, v_in, v_res, v_amt);
  if v_in > 0 then
    v_uv := post_voucher('UV', m_end, 'ภ.พ.30 ย้ายภาษีซื้อ', 'PP30', v_id::text, jsonb_build_array(
      jsonb_build_object('account','17111','debit',v_in), jsonb_build_object('account','17113','credit',v_in)));
  end if;
  v_lines := '[]'::jsonb;
  if v_out > 0 then v_lines := v_lines || jsonb_build_object('account','27111','debit',v_out); end if;
  if v_res = 'refund' then v_lines := v_lines || jsonb_build_object('account','17114','debit',v_amt); end if;
  if v_in  > 0 then v_lines := v_lines || jsonb_build_object('account','17111','credit',v_in); end if;
  if v_res = 'payable' then v_lines := v_lines || jsonb_build_object('account','27140','credit',v_amt); end if;
  if jsonb_array_length(v_lines) >= 2 then
    v_jv := post_voucher('JV', m_end, 'ภ.พ.30 หักกลบภาษี', 'PP30', v_id::text, v_lines);
  end if;
  update pp30_filings set uv_voucher_id = v_uv, jv_voucher_id = v_jv where id = v_id;
  return v_id;
end $$;
create function pay_pp30(p_id uuid, p_date date, p_pay_account text default '11112') returns uuid
language plpgsql as $$
declare f pp30_filings; v uuid;
begin
  select * into f from pp30_filings where id = p_id for update;
  if not found or f.status <> 'filed' or f.result <> 'payable' then raise exception 'ชำระได้เฉพาะแบบที่มียอดต้องชำระ'; end if;
  if f.pv_voucher_id is not null then raise exception 'บันทึกชำระแล้ว'; end if;
  v := post_voucher('PV', p_date, 'ชำระ ภ.พ.30', 'PP30-PAY', p_id::text, jsonb_build_array(
        jsonb_build_object('account','27140','debit',f.amount), jsonb_build_object('account',p_pay_account,'credit',f.amount)));
  update pp30_filings set pv_voucher_id = v, paid_date = p_date where id = p_id;
  return v;
end $$;
create function reset_pp30_payment(p_id uuid) returns void language plpgsql as $$
declare f pp30_filings;
begin
  select * into f from pp30_filings where id = p_id for update;
  if not found or f.pv_voucher_id is null then raise exception 'ยังไม่ได้บันทึกชำระ'; end if;
  perform reverse_voucher(f.pv_voucher_id);
  update pp30_filings set pv_voucher_id = null, paid_date = null where id = p_id;
end $$;
create function set_pp30_refund(p_id uuid, p_recorded boolean) returns void language plpgsql as $$
begin
  update pp30_filings set refund_recorded = p_recorded where id = p_id and status = 'filed' and result = 'refund';
  if not found then raise exception 'ใช้ได้เฉพาะแบบที่ขอคืน'; end if;
end $$;
create function delete_pp30(p_id uuid) returns void language plpgsql as $$
declare f pp30_filings;
begin
  select * into f from pp30_filings where id = p_id for update;
  if not found or f.status = 'deleted' then raise exception 'ไม่พบแบบหรือถูกลบแล้ว'; end if;
  if f.pv_voucher_id is not null then raise exception 'ต้องรีเซ็ตการชำระก่อนลบแบบ'; end if;
  if f.uv_voucher_id is not null then perform reverse_voucher(f.uv_voucher_id); end if;
  if f.jv_voucher_id is not null then perform reverse_voucher(f.jv_voucher_id); end if;
  update pp30_filings set status = 'deleted' where id = p_id;
end $$;
create function income_statement(p_from date, p_to date)
returns table (section text, code text, name text, amount numeric) language sql stable as $$
  select case a.type when 'revenue' then 'revenue' else 'expense' end, a.code, a.name,
         sum(case a.type when 'revenue' then l.credit - l.debit else l.debit - l.credit end)
    from journal_lines l join journal_vouchers v on v.id = l.voucher_id join accounts a on a.id = l.account_id
   where a.type in ('revenue','expense') and v.voucher_date between p_from and p_to and v.voucher_type <> 'CP'
   group by a.type, a.code, a.name
  having sum(l.debit + l.credit) <> 0
   order by 1 desc, 2;
$$;
create function net_profit(p_from date, p_to date) returns numeric language sql stable as $$
  select coalesce(sum(case when section = 'revenue' then amount else -amount end), 0) from income_statement(p_from, p_to);
$$;
create function balance_sheet(p_asof date)
returns table (section text, code text, name text, amount numeric) language sql stable as $$
  with bal as (
    select a.type, a.code, a.name, sum(l.debit - l.credit) as net
      from journal_lines l join journal_vouchers v on v.id = l.voucher_id join accounts a on a.id = l.account_id
     where v.voucher_date <= p_asof group by a.type, a.code, a.name having sum(l.debit - l.credit) <> 0)
  select 'asset', code, name, net from bal where type = 'asset'
  union all select 'liability', code, name, -net from bal where type = 'liability'
  union all select 'equity', code, name, -net from bal where type = 'equity'
  union all select 'equity', '', 'กำไร(ขาดทุน)สะสมงวดปัจจุบัน', -coalesce(sum(net), 0) from bal where type in ('revenue','expense')
  order by 1, 2;
$$;
create function account_ledger(p_code text, p_from date, p_to date)
returns table (entry_date date, voucher_no text, memo text, debit numeric, credit numeric, balance numeric)
language sql stable as $$
  with a as (select id from accounts where code = p_code),
  opening as (
    select coalesce(sum(l.debit - l.credit), 0) as bal
      from journal_lines l join journal_vouchers v on v.id = l.voucher_id
     where l.account_id = (select id from a) and v.voucher_date < p_from),
  rows_ as (
    select v.voucher_date as d, v.voucher_no as no, v.memo as memo, l.debit, l.credit, v.created_at, l.line_no
      from journal_lines l join journal_vouchers v on v.id = l.voucher_id
     where l.account_id = (select id from a) and v.voucher_date between p_from and p_to)
  select null::date, 'ยอดยกมา', null::text, 0::numeric, 0::numeric, (select bal from opening)
  union all
  select d, no, memo, debit, credit,
         (select bal from opening) + sum(debit - credit) over (order by d, created_at, no, line_no)
    from rows_;
$$;
insert into system_accounts values ('retained_earnings', '32000', 'กำไรสะสม (ชั่วคราว ต้องยืนยันกับผังบัญชี)');
create table year_closes (
  year int not null, status text not null default 'closed' check (status in ('closed','reset')),
  voucher_id uuid not null references journal_vouchers(id), created_at timestamptz not null default now()
);
create unique index year_closes_one_active on year_closes (year) where status = 'closed';
create function close_year(p_year int) returns uuid language plpgsql as $$
declare v_end date := make_date(p_year, 12, 31); v_start date := make_date(p_year, 1, 1);
        r record; v_lines jsonb := '[]'::jsonb; v_net numeric := 0; v uuid;
begin
  if exists (select 1 from year_closes where year = p_year and status = 'closed') then
    raise exception 'ปี % ปิดงวดแล้ว', p_year;
  end if;
  for r in select * from income_statement(v_start, v_end) loop
    if r.section = 'revenue' then
      v_lines := v_lines || jsonb_build_object('account', r.code, case when r.amount > 0 then 'debit' else 'credit' end, abs(r.amount));
      v_net := v_net + r.amount;
    else
      v_lines := v_lines || jsonb_build_object('account', r.code, case when r.amount > 0 then 'credit' else 'debit' end, abs(r.amount));
      v_net := v_net - r.amount;
    end if;
  end loop;
  if jsonb_array_length(v_lines) = 0 then raise exception 'ปี % ไม่มีรายการรายได้/ค่าใช้จ่ายให้ปิดงวด', p_year; end if;
  if v_net <> 0 then
    v_lines := v_lines || jsonb_build_object('account', sys_account('retained_earnings'),
                                             case when v_net > 0 then 'credit' else 'debit' end, abs(v_net));
  end if;
  v := post_voucher('CP', v_end, 'ปิดงวดบัญชีปี ' || p_year, 'CLOSE', p_year::text, v_lines);
  insert into year_closes(year, voucher_id) values (p_year, v);
  return v;
end $$;
create function reset_year_close(p_year int) returns void language plpgsql as $$
declare c year_closes;
begin
  select * into c from year_closes where year = p_year and status = 'closed';
  if not found then raise exception 'ปี % ยังไม่ได้ปิดงวด', p_year; end if;
  perform reverse_voucher(c.voucher_id);
  update year_closes set status = 'reset' where year = p_year and status = 'closed';
end $$;
