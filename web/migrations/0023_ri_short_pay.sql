drop function record_purchase_payments(text, uuid, date, jsonb, numeric, text);
create function record_purchase_payments(p_type text, p_doc uuid, p_date date, p_payments jsonb, p_net numeric,
  p_default_account text default '11112', p_short_reason text default null) returns jsonb language plpgsql as $$
declare l jsonb; n int := 0; v_sum numeric := 0; v_amt numeric; v_acc text; v_lines jsonb := '[]'::jsonb;
        v_bank uuid; v_card uuid; v_petty uuid; v_m text; v_cno text; v_cdate date; v_clear date; v_bacc text; v_cv uuid;
begin
  if p_payments is null or jsonb_array_length(p_payments) = 0 then
    p_payments := jsonb_build_array(jsonb_build_object('method','cash','amount',p_net));
  end if;
  for l in select * from jsonb_array_elements(p_payments) loop
    n := n + 1; v_m := l->>'method'; v_amt := (l->>'amount')::numeric;
    v_bank := null; v_card := null; v_petty := null; v_cno := null; v_cdate := null; v_clear := null; v_cv := null;
    if v_amt is null or v_amt <= 0 then raise exception 'จำนวนเงินของช่องทางจ่ายต้องมากกว่า 0'; end if;
    if v_m = 'cash' then v_acc := p_default_account;
    elsif v_m = 'transfer' then
      v_bank := nullif(l->>'bank_account_id','')::uuid;
      select a.code into v_acc from bank_accounts b join accounts a on a.id = b.account_id where b.id = v_bank and b.is_active;
      if v_acc is null then raise exception 'โอนเงินต้องเลือกบัญชีจ่ายเงิน'; end if;
    elsif v_m = 'card' then
      v_card := nullif(l->>'credit_card_id','')::uuid;
      select a.code into v_acc from credit_cards c join accounts a on a.id = c.account_id where c.id = v_card and c.is_active;
      if v_acc is null then raise exception 'จ่ายด้วยบัตรเครดิตต้องเลือกบัตร'; end if;
    elsif v_m = 'petty' then
      v_petty := nullif(l->>'petty_fund_id','')::uuid;
      select a.code into v_acc from petty_funds f join accounts a on a.id = f.account_id where f.id = v_petty and f.is_active;
      if v_acc is null then raise exception 'จ่ายด้วยเงินสดย่อยต้องเลือกวงเงินสดย่อย'; end if;
    elsif v_m = 'cheque' then
      v_bank := nullif(l->>'bank_account_id','')::uuid;
      v_acc := cheque_account_code(v_bank);
      v_cno := nullif(btrim(l->>'cheque_no'), '');
      v_cdate := coalesce(nullif(l->>'cheque_date','')::date, p_date);
      v_clear := nullif(l->>'clear_date','')::date;
      if v_cno is null then raise exception 'เช็คต้องระบุเลขที่เช็ค'; end if;
      if v_clear is null then raise exception 'เช็คต้องระบุวันที่ถูกตัดบัญชี'; end if;
      if v_clear < p_date then raise exception 'วันที่ถูกตัดบัญชีต้องไม่ก่อนวันที่จ่าย'; end if;
      if coalesce((l->>'fee')::numeric, 0) <> 0 then raise exception 'ค่าธรรมเนียมเช็คยังไม่รองรับ (ยังไม่ทดสอบการลงบัญชี)'; end if;
      select a.code into v_bacc from bank_accounts b join accounts a on a.id = b.account_id where b.id = v_bank;
      v_cv := post_voucher('PV', v_clear, 'ตัดเงินตามเช็ค ' || v_cno, p_type || '-CHQ', p_doc::text,
        jsonb_build_array(jsonb_build_object('account', v_acc, 'debit', v_amt), jsonb_build_object('account', v_bacc, 'credit', v_amt)));
    else raise exception 'ช่องทาง % ยังไม่รองรับ (ยังไม่ทดสอบการลงบัญชี)', v_m;
    end if;
    v_sum := v_sum + v_amt;
    insert into purchase_payments(doc_type, doc_id, line_no, method, bank_account_id, credit_card_id, pay_date, amount,
                                  petty_fund_id, cheque_no, cheque_date, clear_date, clear_voucher_id)
    values (p_type, p_doc, n, v_m, v_bank, v_card, p_date, v_amt, v_petty, v_cno, v_cdate, v_clear, v_cv);
    v_lines := v_lines || jsonb_build_object('account', v_acc, 'credit', v_amt);
  end loop;
  if v_sum < p_net and p_short_reason is not null then
    if p_short_reason <> 'discount' then raise exception 'สาเหตุ % ยังไม่รองรับ (ยังไม่ทดสอบการลงบัญชี)', p_short_reason; end if;
    v_lines := v_lines || jsonb_build_object('account', '49090', 'credit', p_net - v_sum);
  elsif v_sum <> p_net then
    raise exception 'ยอดรวมช่องทางจ่าย % ไม่เท่ายอดจ่ายสุทธิ % (จ่ายไม่ครบต้องระบุสาเหตุ; จ่ายเกินยังไม่รองรับ)', v_sum, p_net;
  end if;
  return v_lines;
end $$;
drop function pay_goods_receipt(uuid, date, jsonb);
create function pay_goods_receipt(p_id uuid, p_date date, p_payments jsonb, p_short_reason text default null) returns uuid language plpgsql as $$
declare r goods_receipts; v uuid; v_cr jsonb;
begin
  select * into r from goods_receipts where id = p_id for update;
  if not found or r.status not in ('unpaid','approved') then raise exception 'จ่ายเงินได้เฉพาะใบรับสินค้าที่ยังไม่จ่าย'; end if;
  v_cr := record_purchase_payments('RI', p_id, p_date, p_payments, r.total, '11112', p_short_reason);
  v := post_voucher('PV', p_date, null, 'RI-PAY', p_id::text,
        jsonb_build_array(jsonb_build_object('account','21311','debit',r.total)) || v_cr);
  update goods_receipts set status = 'paid', pv_voucher_id = v where id = p_id;
  return v;
end $$;
