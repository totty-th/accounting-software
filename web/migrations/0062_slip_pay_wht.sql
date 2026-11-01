alter table goods_receipts add column wht_paid numeric(18,2) not null default 0;
alter table wht_certs alter column expense_id drop not null;
alter table wht_certs add column ri_id uuid references goods_receipts(id);
create or replace function slip_doc_info(p_type text, p_id uuid)
returns table (contact_id uuid, doc_no text, doc_date date, due_date date, gross numeric, wht numeric, net numeric, paid boolean, payable boolean)
language sql stable as $$
  select e.contact_id, e.exp_no, e.exp_date, e.due_date, e.total, e.wht_total, e.total - e.wht_total, e.status = 'paid',
         e.status in ('pending','approved')
    from expenses e where p_type = 'EXP' and e.id = p_id
  union all
  select g.contact_id, g.ri_no, g.ri_date, g.due_date, g.total, g.wht_paid, g.total - g.wht_paid, g.status = 'paid', g.status in ('unpaid','approved')
    from goods_receipts g where p_type = 'RI' and g.id = p_id
$$;
create or replace function reset_goods_receipt(p_id uuid) returns void language plpgsql as $$
declare r goods_receipts;
begin
  select * into r from goods_receipts where id = p_id for update;
  if not found or r.status not in ('approved','paid','rejected') then
    raise exception 'รีเซ็ตได้เฉพาะใบรับสินค้าที่อนุมัติ จ่ายแล้ว หรือไม่อนุมัติ';
  end if;
  if r.status = 'paid' then
    perform reverse_voucher(r.pv_voucher_id);
    perform clear_purchase_payments('RI', p_id);
    update goods_receipts set pv_voucher_id = null, wht_paid = 0 where id = p_id;
    update wht_certs set status = 'cancelled' where ri_id = p_id and status <> 'cancelled';
  elsif r.status = 'rejected' then
    update goods_receipts set uv_voucher_id = ri_post_uv(r) where id = p_id;
    perform stock_in(g.product_id, g.warehouse_id, g.qty, g.net, r.ri_date, 'RI', p_id, r.ri_no)
       from goods_receipt_lines g where g.ri_id = p_id order by g.line_no;
  end if;
  update goods_receipts set status = 'unpaid' where id = p_id;
end $$;
create function pay_goods_receipt_wht(p_id uuid, p_date date, p_payments jsonb, p_wht numeric, p_form text, p_cert boolean)
returns uuid language plpgsql as $$
declare r goods_receipts; v uuid; v_cr jsonb; v_lines jsonb; f wht_forms; v_cert uuid;
begin
  select * into r from goods_receipts where id = p_id for update;
  if not found or r.status not in ('unpaid','approved') then raise exception 'จ่ายเงินได้เฉพาะใบรับสินค้าที่ยังไม่จ่าย'; end if;
  if p_wht < 0 or p_wht >= r.total then raise exception 'ยอดหัก ณ ที่จ่ายไม่ถูกต้อง'; end if;
  v_cr := record_purchase_payments('RI', p_id, p_date, p_payments, r.total - p_wht, '11112');
  v_lines := jsonb_build_array(jsonb_build_object('account','21311','debit',r.total));
  if p_wht > 0 then
    select * into f from wht_forms where code = p_form;
    if not found or f.account_code is null then raise exception 'ยังไม่ได้กำหนดบัญชีภาษีหัก ณ ที่จ่ายของแบบ %', p_form; end if;
    v_lines := v_lines || jsonb_build_object('account', f.account_code, 'credit', p_wht);
  end if;
  v := post_voucher('PV', p_date, null, 'RI-PAY', p_id::text, v_lines || v_cr);
  update goods_receipts set status = 'paid', pv_voucher_id = v, wht_paid = p_wht where id = p_id;
  if p_wht > 0 and p_cert then
    v_cert := gen_random_uuid();
    insert into wht_certs(id, cert_no, contact_id, ri_id, form_code, income_type, income_category, pay_date, base_amount, wht_amount)
    values (v_cert, next_doc_no('WT', p_date, true), r.contact_id, p_id, p_form, null, '5', p_date, r.subtotal, p_wht);
    insert into wht_cert_lines values (v_cert, 1, 'ค่าบริการ', round(p_wht * 100 / nullif(r.subtotal, 0), 2), 'none', r.subtotal, r.subtotal, p_wht);
  end if;
  return v;
end $$;
drop function pay_payment_slip_vendor(uuid, uuid, date, jsonb);
create function pay_payment_slip_vendor(p_slip uuid, p_contact uuid, p_date date, p_payments jsonb default null,
  p_wht numeric default 0, p_cert boolean default true, p_form text default 'PND53')
returns int language plpgsql as $$
declare s payment_slips; it record; i record; v_total numeric := 0; v_sum numeric := 0; n int := 0;
        v_rows jsonb; v_rem numeric[] := '{}'; v_idx int; v_need numeric; v_take numeric; v_out jsonb; r jsonb;
        v_base numeric := 0; v_left numeric := p_wht; v_w numeric; v_ri_left int := 0; v_ri_base_left numeric;
begin
  select * into s from payment_slips where id = p_slip for update;
  if not found or s.status <> 'active' then raise exception 'ไม่พบใบเตรียมจ่ายหรือถูกยกเลิกแล้ว'; end if;
  if p_wht < 0 then raise exception 'ยอดหัก ณ ที่จ่ายไม่ถูกต้อง'; end if;
  for it in select x.* from payment_slip_items x where x.slip_id = p_slip order by x.line_no loop
    select * into i from slip_doc_info(it.doc_type, it.doc_id);
    if i.contact_id = p_contact and i.payable then
      v_total := v_total + i.net;
      if it.doc_type = 'RI' then v_base := v_base + (select subtotal from goods_receipts where id = it.doc_id); v_ri_left := v_ri_left + 1; end if;
    end if;
  end loop;
  if v_total = 0 then raise exception 'ไม่มีเอกสารค้างจ่ายของผู้จำหน่ายนี้ในใบเตรียมจ่าย'; end if;
  if p_wht > 0 and v_ri_left = 0 then raise exception 'หัก ณ ที่จ่ายในหน้าจ่ายใช้ได้กับใบรับสินค้าเท่านั้น (ค่าใช้จ่ายตั้งหัก ณ ที่จ่ายที่ตัวเอกสาร)'; end if;
  if p_wht >= v_total then raise exception 'ยอดหัก ณ ที่จ่ายต้องน้อยกว่ายอดจ่าย'; end if;
  if p_payments is not null and jsonb_array_length(p_payments) > 0 then
    v_rows := p_payments;
    for r in select * from jsonb_array_elements(v_rows) loop
      v_rem := v_rem || (r->>'amount')::numeric; v_sum := v_sum + (r->>'amount')::numeric;
    end loop;
    if v_sum <> v_total - p_wht then raise exception 'ยอดรวมช่องทางจ่าย % ไม่เท่ายอดจ่ายสุทธิ %', v_sum, v_total - p_wht; end if;
  end if;
  v_ri_base_left := v_base;
  for it in select x.* from payment_slip_items x where x.slip_id = p_slip order by x.line_no loop
    select * into i from slip_doc_info(it.doc_type, it.doc_id);
    continue when i.contact_id <> p_contact or not i.payable;
    v_w := 0;
    if it.doc_type = 'RI' and p_wht > 0 then
      v_ri_left := v_ri_left - 1;
      v_w := case when v_ri_left = 0 then v_left
                  else round(p_wht * (select subtotal from goods_receipts where id = it.doc_id) / v_base, 2) end;
      v_left := v_left - v_w;
    end if;
    v_out := null;
    if v_rows is not null then
      v_out := '[]'::jsonb; v_need := i.net - v_w; v_idx := 0;
      for r in select * from jsonb_array_elements(v_rows) loop
        v_idx := v_idx + 1;
        continue when v_rem[v_idx] <= 0 or v_need <= 0;
        v_take := least(v_rem[v_idx], v_need);
        v_out := v_out || jsonb_set(r, '{amount}', to_jsonb(v_take));
        v_rem[v_idx] := v_rem[v_idx] - v_take; v_need := v_need - v_take;
      end loop;
    end if;
    if it.doc_type = 'EXP' then perform pay_expense(it.doc_id, p_date, '11112', true, 'PND53', null, v_out);
    else perform pay_goods_receipt_wht(it.doc_id, p_date, v_out, v_w, p_form, p_cert); end if;
    n := n + 1;
  end loop;
  return n;
end $$;
