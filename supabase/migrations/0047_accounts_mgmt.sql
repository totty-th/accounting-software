-- M27.3 บริหารผังบัญชี · ยอดเริ่มต้น (REA FA 28-10-2026: บริหารผังบัญชีเป็นต้นไม้ 10000 สินทรัพย์ … 50000 ค่าใช้จ่าย แต่ละกลุ่มเพิ่มบัญชีลูกได้)
alter table accounts add column description text;

-- ชนิดบัญชีมาจากเลขหลักแรกของรหัส: 1 สินทรัพย์ · 2 หนี้สิน · 3 ส่วนของผู้ถือหุ้น · 4 รายได้ · 5 ค่าใช้จ่าย
create function account_type_of(p_code text) returns text language sql immutable as $$
  select case left(p_code, 1) when '1' then 'asset' when '2' then 'liability' when '3' then 'equity' when '4' then 'revenue' when '5' then 'expense' end
$$;

create function create_account(p_code text, p_name text, p_description text default null) returns uuid language plpgsql as $$
declare v_id uuid; v_code text := btrim(p_code);
begin
  if v_code !~ '^[1-5][0-9]{4}(\.[0-9]{1,3})?$' then raise exception 'รหัสบัญชีต้องเป็นเลข 5 หลัก (ขึ้นต้น 1-5) เช่น 53012 หรือ 53012.01'; end if;
  if coalesce(btrim(p_name), '') = '' then raise exception 'ต้องระบุชื่อบัญชี'; end if;
  if exists (select 1 from accounts where code = v_code) then raise exception 'รหัสบัญชี % มีอยู่แล้ว', v_code; end if;
  insert into accounts(code, name, type, description) values (v_code, btrim(p_name), account_type_of(v_code), nullif(btrim(p_description), '')) returning id into v_id;
  return v_id;
end $$;

-- แก้ชื่อ/คำอธิบาย/เปิด-ปิดใช้งาน (รหัสและชนิดเปลี่ยนไม่ได้) · ปิดใช้งานได้เมื่อยอดคงเหลือเป็นศูนย์ และไม่ใช่บัญชีที่ระบบอ้างอิง
create function update_account(p_id uuid, p_name text, p_description text, p_active boolean) returns void language plpgsql as $$
declare a accounts; v_bal numeric;
begin
  select * into a from accounts where id = p_id;
  if not found then raise exception 'ไม่พบบัญชี'; end if;
  if coalesce(btrim(p_name), '') = '' then raise exception 'ต้องระบุชื่อบัญชี'; end if;
  if a.is_active and not p_active then
    select coalesce(sum(debit - credit), 0) into v_bal from journal_lines where account_id = p_id;
    if v_bal <> 0 then raise exception 'บัญชีนี้ยังมียอดคงเหลือ ปิดใช้งานไม่ได้'; end if;
    if exists (select 1 from system_accounts where account_code = a.code) then raise exception 'บัญชีนี้ระบบใช้ลงบัญชีอัตโนมัติ ปิดใช้งานไม่ได้'; end if;
  end if;
  update accounts set name = btrim(p_name), description = nullif(btrim(p_description), ''), is_active = p_active where id = p_id;
end $$;

-- ยอดเริ่มต้น: ใบสำคัญ JV (source_type = 'OPENING') ณ วันที่กำหนด · มีได้ใบเดียวที่ใช้งานอยู่ — บันทึกใหม่ = กลับรายการใบเดิม (-R) แล้วลงใหม่
-- เฉพาะบัญชีงบฐานะการเงิน (สินทรัพย์/หนี้สิน/ส่วนของผู้ถือหุ้น) · เดบิต = เครดิต
create function set_opening_balance(p_date date, p_lines jsonb) returns uuid language plpgsql as $$
declare o journal_vouchers; l jsonb; v_clean jsonb := '[]'::jsonb; t text;
begin
  if p_date is null then raise exception 'ต้องระบุวันที่ตั้งต้น'; end if;
  for l in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    continue when coalesce(nullif(l->>'debit','')::numeric, 0) = 0 and coalesce(nullif(l->>'credit','')::numeric, 0) = 0;
    select type into t from accounts where code = l->>'account' and is_active;
    if t is null then raise exception 'ไม่พบบัญชี %', l->>'account'; end if;
    if t not in ('asset','liability','equity') then raise exception 'ตั้งยอดเริ่มต้นได้เฉพาะบัญชีสินทรัพย์ หนี้สิน และส่วนของผู้ถือหุ้น (%)', l->>'account'; end if;
    v_clean := v_clean || jsonb_build_array(l);
  end loop;
  for o in select * from journal_vouchers v where v.source_type = 'OPENING' and v.reverses_id is null
            and not exists (select 1 from journal_vouchers r where r.reverses_id = v.id) loop
    perform reverse_voucher(o.id, o.voucher_date);
  end loop;
  if jsonb_array_length(v_clean) = 0 then return null; end if;   -- ล้างยอดเริ่มต้น
  return post_voucher('JV', p_date, 'ยอดเริ่มต้น', 'OPENING', p_date::text, v_clean);
end $$;
