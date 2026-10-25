create or replace function create_deposit_invoice(p_qt uuid, p_date date, p_deposit_net numeric) returns uuid
language plpgsql as $$
declare q sales_docs; v_id uuid := gen_random_uuid(); v_vat numeric; v_total numeric; v uuid; v_ref text;
begin
  select * into q from sales_docs where id = p_qt and doc_type = 'QT' for update;
  if not found or q.status not in ('pending_approval','approved') then raise exception 'ต้องเป็นใบเสนอราคาที่รออนุมัติหรืออนุมัติแล้วและยังไม่มีมัดจำ'; end if;
  if p_deposit_net <= 0 or p_deposit_net > q.subtotal then raise exception 'ยอดมัดจำต้องมากกว่า 0 และไม่เกินมูลค่าใบเสนอราคา'; end if;
  v_vat := round(p_deposit_net * q.vat_rate / 100, 2); v_total := p_deposit_net + v_vat;
  v_ref := 'ใบเสนอราคาเลขที่ ' || q.doc_no || ' มูลค่า ' || to_char(q.total, 'FM999,999,999,990.00') || ' บาท';
  insert into sales_docs(id, doc_type, doc_no, doc_date, contact_id, status, price_mode, vat_rate,
                         subtotal, vat, total, ref_doc_id, is_deposit, internal_note)
  values (v_id, 'INV', next_doc_no('INV', p_date, true), p_date, q.contact_id, 'awaiting_payment', 'exclusive',
          q.vat_rate, p_deposit_net, v_vat, v_total, p_qt, true, 'รับเงินมัดจำ ของ' || v_ref);
  insert into sales_doc_lines(doc_id, line_no, description, detail, item_kind, qty, unit_price, amount)
  values (v_id, 1, 'รับมัดจำ', v_ref, 'service', 1, p_deposit_net, p_deposit_net);
  v := post_voucher('SV', p_date, null, 'INV', v_id::text, jsonb_build_array(
        jsonb_build_object('account','11311','debit',v_total),
        jsonb_build_object('account','21921','credit',p_deposit_net),
        jsonb_build_object('account','27111','credit',v_vat)));
  update sales_docs set voucher_id = v where id = v_id;
  update sales_docs set status = 'deposit_paid' where id = p_qt;
  return v_id;
end $$;
