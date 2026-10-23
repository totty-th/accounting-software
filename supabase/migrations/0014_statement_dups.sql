-- M13.1 ตรวจ statement ซ้ำก่อนนำเข้า
-- รายการซ้ำ = บัญชีเดียวกัน วันที่ จำนวนเงิน คำอธิบาย และยอดคงเหลือตรงกันทั้งหมด
-- นับแบบจำนวนครั้ง: ถ้าในระบบมีรายการเหมือนกัน 1 และไฟล์ใหม่มี 2 รายการเหมือนกัน จะนับซ้ำ 1 (อีก 1 เป็นรายการใหม่จริง)

create function bank_statement_dups(p_bank uuid, p_rows jsonb)
returns table (row_no int, is_dup boolean)
language sql stable as $$
  with r as (
    select ord::int as row_no,
           (j->>'date')::date as d,
           coalesce(nullif(j->>'deposit','')::numeric,0) - coalesce(nullif(j->>'withdrawal','')::numeric,0) as amt,
           coalesce(btrim(j->>'description'),'') as descr,
           nullif(j->>'balance','')::numeric as bal
      from jsonb_array_elements(p_rows) with ordinality as t(j, ord)
  ), k as (
    select r.*, row_number() over (partition by d, amt, descr, bal order by row_no) as nth from r
  ), e as (
    select line_date as d, amount as amt, coalesce(btrim(description),'') as descr, balance as bal, count(*) as c
      from bank_statement_lines where bank_account_id = p_bank
     group by 1,2,3,4
  )
  select k.row_no, k.nth <= coalesce(e.c, 0)
    from k left join e
      on e.d = k.d and e.amt = k.amt and e.descr = k.descr and e.bal is not distinct from k.bal
   order by k.row_no;
$$;

-- นำเข้า: p_skip_dups = true ข้ามรายการที่ซ้ำ (ค่าเริ่มต้น false = นำเข้าทั้งหมดเหมือนเดิม)
drop function bank_statement_import(uuid, text, jsonb);
create function bank_statement_import(p_bank uuid, p_file text, p_rows jsonb, p_skip_dups boolean default false)
returns uuid language plpgsql as $$
declare v_batch uuid := gen_random_uuid(); r jsonb; n int := 0; kept int := 0; d numeric; w numeric;
        v_dups int[];
begin
  if not exists (select 1 from bank_accounts where id = p_bank and is_active) then
    raise exception 'ไม่พบบัญชีธนาคาร';
  end if;
  if p_rows is null or jsonb_array_length(p_rows) = 0 then
    raise exception 'ไม่มีรายการให้นำเข้า';
  end if;
  if p_skip_dups then
    select coalesce(array_agg(row_no), '{}') into v_dups from bank_statement_dups(p_bank, p_rows) where is_dup;
    if coalesce(array_length(v_dups,1),0) = jsonb_array_length(p_rows) then
      raise exception 'ทุกรายการซ้ำกับที่นำเข้าแล้ว';
    end if;
  else
    v_dups := '{}';
  end if;
  insert into bank_statement_batches(id, bank_account_id, file_name) values (v_batch, p_bank, p_file);
  for r in select * from jsonb_array_elements(p_rows) loop
    n := n + 1;
    d := coalesce(nullif(r->>'deposit','')::numeric, 0);
    w := coalesce(nullif(r->>'withdrawal','')::numeric, 0);
    if d < 0 or w < 0 then raise exception 'แถว %: จำนวนเงินติดลบไม่ได้', n; end if;
    if (d > 0) = (w > 0) then raise exception 'แถว %: ต้องมีเงินเข้าหรือเงินออกอย่างใดอย่างหนึ่ง', n; end if;
    continue when n = any(v_dups);
    kept := kept + 1;
    insert into bank_statement_lines(batch_id, bank_account_id, line_no, line_date, description, amount, balance)
    values (v_batch, p_bank, kept, (r->>'date')::date, r->>'description', d - w, nullif(r->>'balance','')::numeric);
  end loop;
  return v_batch;
end $$;
