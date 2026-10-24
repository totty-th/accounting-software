-- M18 ฝั่งซื้อ: อนุมัติ/ไม่อนุมัติ/รีเซ็ต ของใบรับสินค้า (RI) และค่าใช้จ่าย (EXP) + จ่ายหลายช่องทาง (เงินสด/โอน/บัตรเครดิต)
-- อ้างอิง REA FlowAccount 24-10-2026 · RI สถานะ 'unpaid' = รออนุมัติ (คงเดิมเพื่อไม่ให้กระทบรายงานเจ้าหนี้)
-- "ไม่อนุมัติ" = UV ได้ -R + สต็อกของ RI ถูกถอน · "รีเซ็ต" จากไม่อนุมัติ = ผลเหมือนเอกสารกลับมามีผล
--   แต่ฐานข้อมูลห้ามลบใบสำคัญ จึงออก UV ใบใหม่ลงรายการเดิมและรับสต็อกคืน (ใบ -R เดิมคงอยู่เป็นหลักฐาน)
-- เช็ค / เงินสดย่อย / ช่องทางอื่น: ยังไม่ทดสอบการลงบัญชีกับต้นแบบ → ปฏิเสธไว้ก่อน

alter table goods_receipts drop constraint goods_receipts_status_check;
alter table goods_receipts add constraint goods_receipts_status_check
  check (status in ('unpaid','approved','rejected','paid','cancelled'));
alter table expenses drop constraint expenses_status_check;
alter table expenses add constraint expenses_status_check
  check (status in ('pending','approved','rejected','paid','cancelled'));

-- ---------- บัตรเครดิตจ่าย ----------
create table credit_cards (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id),
  bank_name text not null, last4 text not null check (last4 ~ '^[0-9]{4}$'),
  holder_name text not null, card_name text not null,
  credit_limit numeric(18,2) not null check (credit_limit >= 0),
  statement_day int not null check (statement_day between 0 and 31),   -- 0 = สิ้นเดือน
  due_day int not null check (due_day between 1 and 31),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- เปิดบัญชีเจ้าหนี้บัตรเครดิตอัตโนมัติ 21379.NN (หมวดหนี้สิน)
create function create_credit_card(p_bank text, p_last4 text, p_holder text, p_name text,
  p_limit numeric, p_statement_day int, p_due_day int) returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid(); v_acc uuid := gen_random_uuid(); n int;
begin
  select count(*) + 1 into n from credit_cards;
  insert into accounts(id, code, name, type) values (v_acc, '21379.' || lpad(n::text, 2, '0'), 'บัตรเครดิต - ' || p_name, 'liability');
  insert into credit_cards(id, account_id, bank_name, last4, holder_name, card_name, credit_limit, statement_day, due_day)
  values (v_id, v_acc, p_bank, p_last4, p_holder, p_name, p_limit, p_statement_day, p_due_day);
  return v_id;
end $$;

-- ---------- ช่องทางจ่ายของเอกสารซื้อ ----------
create table purchase_payments (
  doc_type text not null check (doc_type in ('EXP','RI')),
  doc_id uuid not null, line_no int not null,
  method text not null check (method in ('cash','transfer','card')),
  bank_account_id uuid references bank_accounts(id),
  credit_card_id uuid references credit_cards(id),
  pay_date date not null,
  amount numeric(18,2) not null check (amount > 0),
  primary key (doc_type, doc_id, line_no)
);

-- p_payments = [{"method":"cash|transfer|card","amount":n,"bank_account_id":"..","credit_card_id":".."}]
-- คืนรายการเครดิตของใบ PV · ว่าง = เงินสด 11112 เต็มจำนวน · ผลรวมต้องเท่ายอดจ่ายสุทธิ
create function record_purchase_payments(p_type text, p_doc uuid, p_date date, p_payments jsonb, p_net numeric,
  p_default_account text default '11112') returns jsonb language plpgsql as $$
declare l jsonb; n int := 0; v_sum numeric := 0; v_amt numeric; v_acc text; v_lines jsonb := '[]'::jsonb;
        v_bank uuid; v_card uuid; v_m text;
begin
  if p_payments is null or jsonb_array_length(p_payments) = 0 then
    p_payments := jsonb_build_array(jsonb_build_object('method','cash','amount',p_net));
  end if;
  for l in select * from jsonb_array_elements(p_payments) loop
    n := n + 1; v_m := l->>'method'; v_amt := (l->>'amount')::numeric; v_bank := null; v_card := null;
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
    else raise exception 'ช่องทาง % ยังไม่รองรับ (ยังไม่ทดสอบการลงบัญชี)', v_m;
    end if;
    v_sum := v_sum + v_amt;
    insert into purchase_payments values (p_type, p_doc, n, v_m, v_bank, v_card, p_date, v_amt);
    v_lines := v_lines || jsonb_build_object('account', v_acc, 'credit', v_amt);
  end loop;
  if v_sum <> p_net then raise exception 'ยอดรวมช่องทางจ่าย % ไม่เท่ายอดจ่ายสุทธิ %', v_sum, p_net; end if;
  return v_lines;
end $$;

-- ---------- ใบรับสินค้า ----------
create function ri_post_uv(r goods_receipts) returns uuid language plpgsql as $$
declare v_lines jsonb;
begin
  v_lines := jsonb_build_array(jsonb_build_object('account', sys_account('inventory'), 'debit', r.subtotal));
  if r.vat > 0 then v_lines := v_lines || jsonb_build_object('account','17113','debit',r.vat); end if;
  v_lines := v_lines || jsonb_build_object('account','21311','credit', r.total);
  return post_voucher('UV', r.ri_date, null, 'RI', r.id::text, v_lines);
end $$;

-- ถอนสต็อกที่ RI รับเข้า (ห้ามถ้าถูกใช้ไปแล้ว)
create function ri_void_stock(p_id uuid) returns void language plpgsql as $$
declare m stock_movements;
begin
  for m in select * from stock_movements where doc_id = p_id and doc_type = 'RI' and voided_at is null and qty_in > 0 loop
    if stock_on_hand(m.product_id, m.warehouse_id) - m.qty_in < 0
       or (select qty from product_stock where product_id = m.product_id) - m.qty_in < 0 then
      raise exception 'ดำเนินการไม่ได้: สต็อกที่รับเข้ามาถูกใช้ไปแล้ว';
    end if;
  end loop;
  for m in select * from stock_movements where doc_id = p_id and doc_type = 'RI' and voided_at is null and qty_in > 0 loop
    update product_stock set qty = qty - m.qty_in, value = value - m.value,
           last_avg = case when qty - m.qty_in > 0 then round((value - m.value) / (qty - m.qty_in), 4) else last_avg end
     where product_id = m.product_id;
    update stock_movements set voided_at = now() where id = m.id;
  end loop;
end $$;

create function approve_goods_receipt(p_id uuid) returns void language plpgsql as $$
begin
  update goods_receipts set status = 'approved' where id = p_id and status = 'unpaid';
  if not found then raise exception 'อนุมัติได้เฉพาะใบรับสินค้าที่รออนุมัติ'; end if;
end $$;

create function reject_goods_receipt(p_id uuid) returns void language plpgsql as $$
declare r goods_receipts;
begin
  select * into r from goods_receipts where id = p_id for update;
  if not found or r.status not in ('unpaid','approved') then raise exception 'ไม่อนุมัติได้เฉพาะใบรับสินค้าที่รออนุมัติหรืออนุมัติแล้ว'; end if;
  perform ri_void_stock(p_id);
  perform reverse_voucher(r.uv_voucher_id);
  update goods_receipts set status = 'rejected' where id = p_id;
end $$;

-- รีเซ็ต: อนุมัติ→รออนุมัติ · จ่ายแล้ว→รออนุมัติ (PV ได้ -R, ล้างช่องทางจ่าย) · ไม่อนุมัติ→รออนุมัติ (ออก UV ใหม่ + รับสต็อกคืน)
create function reset_goods_receipt(p_id uuid) returns void language plpgsql as $$
declare r goods_receipts;
begin
  select * into r from goods_receipts where id = p_id for update;
  if not found or r.status not in ('approved','paid','rejected') then
    raise exception 'รีเซ็ตได้เฉพาะใบรับสินค้าที่อนุมัติ จ่ายแล้ว หรือไม่อนุมัติ';
  end if;
  if r.status = 'paid' then
    perform reverse_voucher(r.pv_voucher_id);
    delete from purchase_payments where doc_type = 'RI' and doc_id = p_id;
    update goods_receipts set pv_voucher_id = null where id = p_id;
  elsif r.status = 'rejected' then
    update goods_receipts set uv_voucher_id = ri_post_uv(r) where id = p_id;
    perform stock_in(g.product_id, g.warehouse_id, g.qty, g.net, r.ri_date, 'RI', p_id, r.ri_no)
       from goods_receipt_lines g where g.ri_id = p_id order by g.line_no;
  end if;
  update goods_receipts set status = 'unpaid' where id = p_id;
end $$;

-- จ่ายเงิน (หลายช่องทาง) จากรออนุมัติหรืออนุมัติแล้ว
create function pay_goods_receipt(p_id uuid, p_date date, p_payments jsonb) returns uuid language plpgsql as $$
declare r goods_receipts; v uuid; v_cr jsonb;
begin
  select * into r from goods_receipts where id = p_id for update;
  if not found or r.status not in ('unpaid','approved') then raise exception 'จ่ายเงินได้เฉพาะใบรับสินค้าที่ยังไม่จ่าย'; end if;
  v_cr := record_purchase_payments('RI', p_id, p_date, p_payments, r.total);
  v := post_voucher('PV', p_date, null, 'RI-PAY', p_id::text,
        jsonb_build_array(jsonb_build_object('account','21311','debit',r.total)) || v_cr);
  update goods_receipts set status = 'paid', pv_voucher_id = v where id = p_id;
  return v;
end $$;

create or replace function pay_goods_receipt(p_id uuid, p_date date, p_pay_account text default '11112') returns uuid
language plpgsql as $$
declare r goods_receipts; v uuid;
begin
  select * into r from goods_receipts where id = p_id for update;
  if not found or r.status not in ('unpaid','approved') then raise exception 'จ่ายเงินได้เฉพาะใบรับสินค้าที่ยังไม่จ่าย'; end if;
  v := post_voucher('PV', p_date, null, 'RI-PAY', p_id::text, jsonb_build_array(
        jsonb_build_object('account','21311','debit',r.total), jsonb_build_object('account',p_pay_account,'credit',r.total)));
  update goods_receipts set status = 'paid', pv_voucher_id = v where id = p_id;
  return v;
end $$;

create or replace function cancel_goods_receipt(p_id uuid) returns void language plpgsql as $$
declare r goods_receipts;
begin
  select * into r from goods_receipts where id = p_id for update;
  if not found or r.status = 'cancelled' then raise exception 'ไม่พบใบรับสินค้าหรือถูกยกเลิกแล้ว'; end if;
  if r.status <> 'rejected' then   -- ไม่อนุมัติไว้แล้ว = UV กลับรายการและสต็อกถอนไปแล้ว
    perform ri_void_stock(p_id);
    if r.pv_voucher_id is not null then perform reverse_voucher(r.pv_voucher_id); end if;
    perform reverse_voucher(r.uv_voucher_id);
  end if;
  update goods_receipts set status = 'cancelled' where id = p_id;
end $$;

-- เจ้าหนี้: RI ที่อนุมัติแล้วยังไม่จ่ายนับด้วย
create or replace function ap_aging(p_asof date, p_contact uuid default null)
returns table (contact_id uuid, contact_name text, doc_id uuid, doc_no text, doc_type text, doc_date date, due_date date,
               doc_total numeric, outstanding numeric, bucket text, liability_account text,
               not_due numeric, d1_30 numeric, d31_60 numeric, d61_90 numeric, over90 numeric)
language sql stable as $$
  with x as (
    select e.contact_id, e.id, e.exp_no as doc_no, 'EXP'::text as doc_type, e.exp_date as doc_date, e.due_date,
           e.total, '21399'::text as acct
      from expenses e where e.status in ('pending','approved') and e.exp_date <= p_asof
    union all
    select g.contact_id, g.id, g.ri_no, 'RI', g.ri_date, g.due_date, g.total, '21311'
      from goods_receipts g where g.status in ('unpaid','approved') and g.ri_date <= p_asof
  )
  select x.contact_id, contact_label(x.contact_id), x.id, x.doc_no, x.doc_type, x.doc_date, x.due_date,
         x.total, x.total, aging_bucket(p_asof, x.due_date), x.acct,
         case when aging_bucket(p_asof, x.due_date) = 'not_due' then x.total else 0 end,
         case when aging_bucket(p_asof, x.due_date) = 'd1_30'   then x.total else 0 end,
         case when aging_bucket(p_asof, x.due_date) = 'd31_60'  then x.total else 0 end,
         case when aging_bucket(p_asof, x.due_date) = 'd61_90'  then x.total else 0 end,
         case when aging_bucket(p_asof, x.due_date) = 'over90'  then x.total else 0 end
    from x where (p_contact is null or x.contact_id = p_contact)
   order by contact_label(x.contact_id), x.doc_date, x.doc_no
$$;

-- ---------- ค่าใช้จ่าย ----------
create function exp_post_uv(e expenses) returns uuid language plpgsql as $$
declare v_lines jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('account', account_code, 'debit', net) order by line_no), '[]'::jsonb)
    into v_lines from expense_lines where expense_id = e.id;
  if e.vat > 0 then v_lines := v_lines || jsonb_build_object('account','17113','debit',e.vat); end if;
  v_lines := v_lines || jsonb_build_object('account','21399','credit', e.total);
  return post_voucher('UV', e.exp_date, null, 'EXP', e.id::text, v_lines);
end $$;

create function reject_expense(p_id uuid) returns void language plpgsql as $$
declare e expenses;
begin
  select * into e from expenses where id = p_id for update;
  if not found or e.status not in ('pending','approved') then raise exception 'ไม่อนุมัติได้เฉพาะค่าใช้จ่ายที่รออนุมัติหรืออนุมัติแล้ว'; end if;
  perform reverse_voucher(e.uv_voucher_id);
  update expenses set status = 'rejected' where id = p_id;
end $$;

create or replace function reset_expense(p_id uuid) returns void language plpgsql as $$
declare e expenses;
begin
  select * into e from expenses where id = p_id for update;
  if not found or e.status not in ('approved','paid','rejected') then raise exception 'รีเซ็ตได้เฉพาะค่าใช้จ่ายที่อนุมัติหรือชำระแล้ว หรือไม่อนุมัติ'; end if;
  if e.status = 'paid' then
    perform reverse_voucher(e.pv_voucher_id);
    delete from purchase_payments where doc_type = 'EXP' and doc_id = p_id;
    update wht_certs set status = 'cancelled' where expense_id = p_id and status = 'active';
    update expenses set pv_voucher_id = null, paid_date = null where id = p_id;
  elsif e.status = 'rejected' then
    update expenses set uv_voucher_id = exp_post_uv(e) where id = p_id;
  end if;
  update expenses set status = 'pending' where id = p_id;
end $$;

create or replace function cancel_expense(p_id uuid) returns void language plpgsql as $$
declare e expenses;
begin
  select * into e from expenses where id = p_id for update;
  if not found or e.status = 'cancelled' then raise exception 'ไม่พบค่าใช้จ่ายหรือถูกยกเลิกแล้ว'; end if;
  if e.status <> 'rejected' then
    if e.pv_voucher_id is not null then perform reverse_voucher(e.pv_voucher_id); end if;
    perform reverse_voucher(e.uv_voucher_id);
  end if;
  update wht_certs set status = 'cancelled' where expense_id = p_id and status = 'active';
  update expenses set status = 'cancelled' where id = p_id;
end $$;

-- จ่ายค่าใช้จ่าย: เพิ่ม p_payments (หลายช่องทาง) ต่อท้ายพารามิเตอร์เดิม
drop function pay_expense(uuid, date, text, boolean, text, text);
create function pay_expense(p_id uuid, p_date date, p_pay_account text default '11112',
  p_create_cert boolean default true, p_form text default 'PND53', p_income_type text default null,
  p_payments jsonb default null)
returns uuid language plpgsql as $$
declare e expenses; f wht_forms; v_lines jsonb; v uuid;
begin
  select * into e from expenses where id = p_id for update;
  if not found or e.status not in ('pending','approved') then
    raise exception 'จ่ายเงินได้เฉพาะค่าใช้จ่ายที่รอดำเนินการหรืออนุมัติแล้ว';
  end if;
  v_lines := jsonb_build_array(jsonb_build_object('account','21399','debit',e.total));
  if e.wht_total > 0 then
    select * into f from wht_forms where code = p_form;
    if not found or f.account_code is null then
      raise exception 'ยังไม่ได้กำหนดบัญชีภาษีหัก ณ ที่จ่ายของแบบ %', p_form;
    end if;
    v_lines := v_lines || jsonb_build_object('account', f.account_code, 'credit', e.wht_total);
  end if;
  v_lines := v_lines || record_purchase_payments('EXP', p_id, p_date, p_payments, e.total - e.wht_total, p_pay_account);
  v := post_voucher('PV', p_date, null, 'EXP-PAY', p_id::text, v_lines);
  update expenses set status = 'paid', pv_voucher_id = v, paid_date = p_date where id = p_id;
  if e.wht_total > 0 and p_create_cert then
    insert into wht_certs(cert_no, expense_id, form_code, income_type, pay_date, base_amount, wht_amount)
    select next_doc_no('WT', p_date, true), p_id, p_form, p_income_type, p_date,
           (select sum(net) from expense_lines where expense_id = p_id and wht > 0), e.wht_total;
  end if;
  return v;
end $$;
