alter table receipts add column share_token text unique;
create function ensure_receipt_share_token(p_id uuid) returns text language plpgsql as $$
declare v text;
begin
  select share_token into v from receipts where id = p_id for update;
  if not found then raise exception 'ไม่พบใบเสร็จ'; end if;
  if v is null then
    v := substr(replace(gen_random_uuid()::text, '-', ''), 1, 26);
    update receipts set share_token = v where id = p_id;
  end if;
  return v;
end $$;
create function revoke_receipt_share_token(p_id uuid) returns void language sql as $$
  update receipts set share_token = null where id = p_id;
$$;
create function receipt_by_token(p_token text) returns uuid language sql stable as $$
  select id from receipts where share_token = p_token and p_token is not null;
$$;
create table receipt_payments (
  receipt_id uuid not null references receipts(id),
  line_no    int  not null,
  method     text not null check (method in ('cash','transfer','cheque','card','other')),
  bank       text,
  ref_no     text,
  bank_account_id uuid references bank_accounts(id),
  pay_date   date not null,
  amount     numeric(18,2) not null check (amount > 0),
  primary key (receipt_id, line_no)
);
drop function collect_receipt(uuid, date);
create function collect_receipt(p_id uuid, p_date date, p_payments jsonb default null) returns void language plpgsql as $$
declare r receipts; v uuid; v_lines jsonb; p jsonb; n int := 0; v_sum numeric := 0; v_net numeric; v_cash numeric := 0; ba bank_accounts; ac text;
begin
  select * into r from receipts where id = p_id for update;
  if not found or r.status <> 'pending' then raise exception 'เก็บเงินได้เฉพาะใบเสร็จที่รอเก็บเงิน'; end if;
  v_net := r.amount - r.wht;
  if p_payments is null or jsonb_array_length(p_payments) = 0 then   -- ไม่ระบุ = เงินสดเต็มจำนวน
    p_payments := jsonb_build_array(jsonb_build_object('method','cash','amount',v_net));
  end if;
  for p in select * from jsonb_array_elements(p_payments) loop
    n := n + 1; v_sum := v_sum + (p->>'amount')::numeric;
    if coalesce(p->>'method','') not in ('cash','transfer','cheque','card','other') then raise exception 'ช่องทางรับชำระไม่ถูกต้อง'; end if;
    if (p->>'amount')::numeric <= 0 then raise exception 'จำนวนเงินของช่องทางรับชำระต้องมากกว่า 0'; end if;
    if p->>'method' = 'transfer' then   -- โอนเงิน: ต้องเลือกบัญชีธนาคารของบริษัท
      select * into ba from bank_accounts where id = nullif(p->>'bank_account_id','')::uuid and is_active;
      if not found then raise exception 'โอนเงินต้องเลือกบัญชีรับเงิน'; end if;
    end if;
  end loop;
  if v_sum <> v_net then raise exception 'ยอดรวมช่องทางรับชำระ % ไม่เท่ายอดรับสุทธิ %', v_sum, v_net; end if;
  v_lines := '[]'::jsonb;
  for ac, v_cash in
    select case when x->>'method' = 'transfer' then (select a.code from bank_accounts b join accounts a on a.id = b.account_id
                                                      where b.id = (x->>'bank_account_id')::uuid) else '11112' end,
           sum((x->>'amount')::numeric)
    from jsonb_array_elements(p_payments) x group by 1 order by 1
  loop v_lines := v_lines || jsonb_build_object('account', ac, 'debit', v_cash); end loop;
  if r.wht > 0 then v_lines := v_lines || jsonb_build_object('account','17120','debit', r.wht); end if;
  v_lines := v_lines || jsonb_build_object('account','11319','credit', r.amount);
  v := post_voucher('RV', p_date, null, 'RE-COLLECT', p_id::text, v_lines);
  n := 0;
  for p in select * from jsonb_array_elements(p_payments) loop
    n := n + 1;
    select * into ba from bank_accounts where id = nullif(p->>'bank_account_id','')::uuid;
    insert into receipt_payments(receipt_id, line_no, method, bank, ref_no, bank_account_id, pay_date, amount)
    values (p_id, n, p->>'method', coalesce(ba.bank_name, nullif(btrim(p->>'bank'),'')),
            coalesce(ba.account_no, nullif(btrim(p->>'ref_no'),'')), ba.id, p_date, (p->>'amount')::numeric);
  end loop;
  update receipts set status = 'collected', collect_voucher_id = v, collected_date = p_date where id = p_id;
end $$;
create or replace function reset_receipt(p_id uuid) returns void language plpgsql as $$
declare r receipts;
begin
  select * into r from receipts where id = p_id for update;
  if not found or r.status <> 'collected' then raise exception 'รีเซ็ตได้เฉพาะใบเสร็จที่เก็บเงินแล้ว'; end if;
  perform reverse_voucher(r.collect_voucher_id);
  delete from receipt_payments where receipt_id = p_id;
  update receipts set status = 'pending', collect_voucher_id = null, collected_date = null where id = p_id;
end $$;
create or replace function receipt_view(p_id uuid) returns jsonb language plpgsql stable as $$
declare r receipts; c contacts; v jsonb; rate numeric; vat numeric;
begin
  select * into r from receipts where id = p_id;
  if not found then raise exception 'ไม่พบใบเสร็จ'; end if;
  select * into c from contacts where id = r.contact_id;
  select max(d.vat_rate) into rate from receipt_items i join sales_docs d on d.id = i.doc_id where i.receipt_id = r.id;
  vat := case when rate is null then 0 else round(r.amount * rate / (100 + rate), 2) end;
  select jsonb_build_object(
    'receipt', jsonb_build_object('id', r.id, 'receipt_no', r.receipt_no, 'kind', r.kind, 'receipt_date', r.receipt_date,
      'status', r.status, 'amount', r.amount, 'wht', r.wht, 'collected_date', r.collected_date,
      'vat_rate', rate, 'vat', vat, 'base', r.amount - vat),
    'contact', jsonb_build_object('id', c.id, 'name', coalesce(nullif(c.business_name,''), c.contact_name),
      'address', c.address, 'tax_id', c.tax_id),
    'company', (select jsonb_build_object('name', name, 'address', address, 'tax_id', tax_id) from company_profile limit 1),
    'items', coalesce((select jsonb_agg(jsonb_build_object('line_no', i.line_no, 'doc_no', d.doc_no, 'doc_date', d.doc_date,
        'due_date', d.due_date, 'doc_total', d.total, 'description', i.description, 'amount', i.amount, 'wht', i.wht)
        order by i.line_no)
      from receipt_items i left join sales_docs d on d.id = i.doc_id where i.receipt_id = r.id), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(jsonb_build_object('method', method, 'bank', bank, 'ref_no', ref_no,
        'pay_date', pay_date, 'amount', amount) order by line_no) from receipt_payments where receipt_id = r.id), '[]'::jsonb)
  ) into v;
  return v;
end $$;
