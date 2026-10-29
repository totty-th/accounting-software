-- M27.9 เมนูการเงินแบบ FA (REA 29-10-2026): บัญชีเงินสดย่อย / บัญชีเช็คจ่าย / บัตรเครดิตจ่าย
-- เติมเงินสดย่อย (ทดสอบจริงใน FA): JV Dr 11149.NN เงินสดย่อย / Cr บัญชีต้นทาง (เช่น 11112) · คำอธิบาย "เติมวงเงินสดย่อย <ชื่อ> จำนวน <จำนวน> บาท"
-- เติมเกินวงเงิน: FA แสดงแค่คำแนะนำ "เติม X เพื่อให้เต็มวงเงิน" ไม่พบว่าบล็อก → ไม่ตรวจ (ยังไม่ทดสอบ)
-- แก้ไข / ไม่ใช้งาน / ลบ: ลบได้เฉพาะบัญชีที่ยังไม่มีรายการลงบัญชีและไม่ถูกใช้ในช่องทางจ่ายของเอกสารซื้อ

create function topup_petty_fund(p_fund uuid, p_date date, p_amount numeric, p_from text) returns uuid language plpgsql as $$
declare f petty_funds; v_code text;
begin
  select * into f from petty_funds where id = p_fund and is_active;
  if not found then raise exception 'ไม่พบบัญชีเงินสดย่อย หรือไม่ใช้งานแล้ว'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'จำนวนเงินที่เติมต้องมากกว่า 0'; end if;
  if p_from is null or not exists (select 1 from accounts where code = p_from and is_active) then raise exception 'ต้องเลือกบัญชีที่เติมเงินจาก'; end if;
  select code into v_code from accounts where id = f.account_id;
  return bank_transfer(p_from, v_code, p_date, p_amount, 0, '53211', 'เติมวงเงินสดย่อย ' || f.fund_name || ' จำนวน ' || trim_scale(p_amount)::text || ' บาท');
end $$;

create function update_petty_fund(p_id uuid, p_name text, p_limit numeric, p_responsible text default null, p_note text default null) returns void language plpgsql as $$
declare f petty_funds;
begin
  if coalesce(btrim(p_name), '') = '' then raise exception 'ต้องระบุชื่อวงเงินสดย่อย'; end if;
  if p_limit is null or p_limit < 0 then raise exception 'วงเงินต้องไม่ติดลบ'; end if;
  select * into f from petty_funds where id = p_id; if not found then raise exception 'ไม่พบบัญชีเงินสดย่อย'; end if;
  update petty_funds set fund_name = btrim(p_name), credit_limit = p_limit, responsible = nullif(btrim(p_responsible), ''), note = nullif(btrim(p_note), '') where id = p_id;
  update accounts set name = 'เงินสดย่อย - ' || btrim(p_name) where id = f.account_id;
end $$;
create function set_petty_fund_active(p_id uuid, p_active boolean) returns void language plpgsql as $$
begin update petty_funds set is_active = p_active where id = p_id; if not found then raise exception 'ไม่พบบัญชีเงินสดย่อย'; end if; end $$;

-- ใช้ร่วม: บัญชีนี้มีรายการลงบัญชีหรือไม่
create function account_has_activity(p_account uuid) returns boolean language sql stable as $$
  select exists (select 1 from journal_lines where account_id = p_account) $$;

create function delete_petty_fund(p_id uuid) returns void language plpgsql as $$
declare f petty_funds;
begin
  select * into f from petty_funds where id = p_id; if not found then raise exception 'ไม่พบบัญชีเงินสดย่อย'; end if;
  if account_has_activity(f.account_id) or exists (select 1 from purchase_payments where petty_fund_id = p_id) then
    raise exception 'ลบไม่ได้: บัญชีนี้มีรายการแล้ว (ใช้ "ไม่ใช้งาน" แทน)'; end if;
  delete from petty_funds where id = p_id; delete from accounts where id = f.account_id;
end $$;

create function update_credit_card(p_id uuid, p_bank text, p_last4 text, p_holder text, p_name text, p_limit numeric, p_statement_day int, p_due_day int) returns void language plpgsql as $$
declare c credit_cards;
begin
  select * into c from credit_cards where id = p_id; if not found then raise exception 'ไม่พบบัตรเครดิต'; end if;
  if coalesce(btrim(p_name), '') = '' then raise exception 'ต้องระบุชื่อบัตร'; end if;
  update credit_cards set bank_name = p_bank, last4 = p_last4, holder_name = p_holder, card_name = btrim(p_name), credit_limit = p_limit, statement_day = p_statement_day, due_day = p_due_day where id = p_id;
  update accounts set name = 'บัตรเครดิต - ' || btrim(p_name) where id = c.account_id;
end $$;
create function set_credit_card_active(p_id uuid, p_active boolean) returns void language plpgsql as $$
begin update credit_cards set is_active = p_active where id = p_id; if not found then raise exception 'ไม่พบบัตรเครดิต'; end if; end $$;
create function delete_credit_card(p_id uuid) returns void language plpgsql as $$
declare c credit_cards;
begin
  select * into c from credit_cards where id = p_id; if not found then raise exception 'ไม่พบบัตรเครดิต'; end if;
  if account_has_activity(c.account_id) or exists (select 1 from purchase_payments where credit_card_id = p_id) then
    raise exception 'ลบไม่ได้: บัตรนี้มีรายการแล้ว (ใช้ "ไม่ใช้งาน" แทน)'; end if;
  delete from credit_cards where id = p_id; delete from accounts where id = c.account_id;
end $$;

-- บัญชีเช็คจ่าย: เพิ่มบัญชี (ผูกกับบัญชีธนาคาร) · ไม่ใช้งาน · ลบ
alter table cheque_accounts add column is_active boolean not null default true;
create function add_cheque_account(p_bank uuid) returns text language plpgsql as $$
begin return cheque_account_code(p_bank); end $$;
create function set_cheque_account_active(p_bank uuid, p_active boolean) returns void language plpgsql as $$
begin update cheque_accounts set is_active = p_active where bank_account_id = p_bank; if not found then raise exception 'ไม่พบบัญชีเช็คจ่าย'; end if; end $$;
create function delete_cheque_account(p_bank uuid) returns void language plpgsql as $$
declare c cheque_accounts;
begin
  select * into c from cheque_accounts where bank_account_id = p_bank; if not found then raise exception 'ไม่พบบัญชีเช็คจ่าย'; end if;
  if account_has_activity(c.account_id) or exists (select 1 from purchase_payments where method = 'cheque' and bank_account_id = p_bank) then
    raise exception 'ลบไม่ได้: บัญชีนี้มีรายการเช็คแล้ว (ใช้ "ไม่ใช้งาน" แทน)'; end if;
  delete from cheque_accounts where bank_account_id = p_bank; delete from accounts where id = c.account_id;
end $$;

-- รายการเคลื่อนไหวของบัญชี (ใช้ทั้งเงินสดย่อย/เช็ค/บัตรเครดิต): เรียงตามวันที่ แล้วเวลาที่บันทึก · รวมใบกลับรายการ (-R)
create function account_movements(p_account uuid, p_from date, p_to date)
returns table (voucher_id uuid, voucher_no text, voucher_date date, memo text, debit numeric, credit numeric)
language sql stable as $$
  select v.id, v.voucher_no, v.voucher_date, coalesce(l.description, v.memo), l.debit, l.credit
    from journal_lines l join journal_vouchers v on v.id = l.voucher_id
   where l.account_id = p_account and (p_from is null or v.voucher_date >= p_from) and (p_to is null or v.voucher_date <= p_to)
   order by v.voucher_date, v.created_at, v.voucher_no, l.line_no
$$;
