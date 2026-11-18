create or replace function bank_match_with_diff(p_lines uuid[], p_items uuid[], p_account text,
                                     p_memo text, p_date date default null) returns uuid
language plpgsql as $$
declare v_bank uuid; v_acc text; v_sl numeric; v_si numeric; v_diff numeric; v_date date;
        v_v uuid; v_line uuid; v_g uuid;
begin
  if coalesce(array_length(p_lines,1),0) = 0 then
    raise exception 'ต้องเลือกรายการธนาคารอย่างน้อย 1 รายการ';
  end if;
  p_items := coalesce(p_items, '{}');   -- M13.5: ไม่มีเอกสาร = บันทึก JV เต็มยอดรายการธนาคาร (เช่น ดอกเบี้ย/ค่าธรรมเนียมที่ยังไม่ได้บันทึก)
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
alter function bank_match_with_diff(uuid[], uuid[], text, text, date) set search_path = public, pg_temp;
