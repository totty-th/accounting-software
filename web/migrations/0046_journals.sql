alter table journal_vouchers add column contact_id uuid references contacts(id), add column ref_no text, add column note text;
alter table journal_lines add column description text;
create table jv_drafts (
  id uuid primary key default gen_random_uuid(),
  draft_no text not null unique,
  doc_date date, contact_id uuid references contacts(id), ref_no text, memo text, note text,
  lines jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create function save_jv_draft(p_id uuid, p jsonb) returns uuid language plpgsql as $$
declare v_id uuid := coalesce(p_id, gen_random_uuid()); v_n int;
begin
  if p_id is null then
    insert into doc_sequences(prefix, bucket, last_no) values ('DJV', date '0001-01-01', 1)
    on conflict (prefix, bucket) do update set last_no = doc_sequences.last_no + 1 returning last_no into v_n;
    insert into jv_drafts(id, draft_no, doc_date, contact_id, ref_no, memo, note, lines)
    values (v_id, 'Draft JV' || v_n, nullif(p->>'date','')::date, nullif(p->>'contact_id','')::uuid, nullif(p->>'ref_no',''), nullif(p->>'memo',''), nullif(p->>'note',''), coalesce(p->'lines','[]'::jsonb));
  else
    update jv_drafts set doc_date = nullif(p->>'date','')::date, contact_id = nullif(p->>'contact_id','')::uuid, ref_no = nullif(p->>'ref_no',''),
           memo = nullif(p->>'memo',''), note = nullif(p->>'note',''), lines = coalesce(p->'lines','[]'::jsonb), updated_at = now() where id = p_id;
    if not found then raise exception 'ไม่พบร่างรายการ'; end if;
  end if;
  return v_id;
end $$;
create function delete_jv_draft(p_id uuid) returns void language plpgsql as $$
begin delete from jv_drafts where id = p_id; if not found then raise exception 'ไม่พบร่างรายการ'; end if; end $$;
create function create_jv(p jsonb, p_draft uuid default null) returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid(); v_no text; v_date date := nullif(p->>'date','')::date; l jsonb; n int := 0;
        v_acc uuid; v_dr numeric := 0; v_cr numeric := 0; d numeric; c numeric;
begin
  if v_date is null then raise exception 'ต้องระบุวันที่เอกสาร'; end if;
  if coalesce(jsonb_array_length(p->'lines'), 0) < 2 then raise exception 'ใบสำคัญต้องมีอย่างน้อย 2 รายการ'; end if;
  perform assert_period_open(v_date);
  v_no := next_doc_no('JV', v_date, false);
  insert into journal_vouchers(id, voucher_type, voucher_no, voucher_date, memo, source_type, contact_id, ref_no, note)
  values (v_id, 'JV', v_no, v_date, nullif(p->>'memo',''), 'MANUAL', nullif(p->>'contact_id','')::uuid, nullif(p->>'ref_no',''), nullif(p->>'note',''));
  for l in select * from jsonb_array_elements(p->'lines') loop
    select id into v_acc from accounts where code = l->>'account' and is_active;
    if v_acc is null then raise exception 'ไม่พบบัญชี %', coalesce(l->>'account', '(ไม่ได้เลือก)'); end if;
    d := coalesce(nullif(l->>'debit','')::numeric, 0); c := coalesce(nullif(l->>'credit','')::numeric, 0);
    if d < 0 or c < 0 or (d > 0 and c > 0) or (d = 0 and c = 0) then raise exception 'แต่ละรายการต้องมีเดบิตหรือเครดิตอย่างใดอย่างหนึ่งเท่านั้น (บัญชี %)', l->>'account'; end if;
    v_dr := v_dr + d; v_cr := v_cr + c; n := n + 1;
    insert into journal_lines(voucher_id, line_no, account_id, debit, credit, description) values (v_id, n, v_acc, d, c, nullif(l->>'desc',''));
  end loop;
  if v_dr <> v_cr then raise exception 'เดบิต (%) ไม่เท่ากับเครดิต (%)', v_dr, v_cr; end if;
  if p_draft is not null then delete from jv_drafts where id = p_draft; end if;
  return v_id;
end $$;
create function journal_list(p_types text[], p_from date, p_to date, p_q text, p_limit int, p_offset int)
returns table (id uuid, voucher_type text, voucher_no text, voucher_date date, memo text, total numeric, status text, source_type text, total_rows bigint)
language sql stable as $$
  select v.id, v.voucher_type, v.voucher_no, v.voucher_date, v.memo,
         (select coalesce(sum(debit), 0) from journal_lines where voucher_id = v.id),
         case when v.reverses_id is not null then 'reversal' when exists (select 1 from journal_vouchers r where r.reverses_id = v.id) then 'reversed' else 'normal' end,
         v.source_type, count(*) over ()
    from journal_vouchers v
   where (p_types is null or v.voucher_type = any(p_types))
     and (p_from is null or v.voucher_date >= p_from) and (p_to is null or v.voucher_date <= p_to)
     and (coalesce(p_q, '') = '' or v.voucher_no ilike '%' || p_q || '%' or v.memo ilike '%' || p_q || '%' or v.ref_no ilike '%' || p_q || '%')
   order by v.voucher_date desc, v.created_at desc, v.voucher_no desc
   limit p_limit offset p_offset
$$;
