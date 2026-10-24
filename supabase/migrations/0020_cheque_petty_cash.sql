-- M18.2 จ่ายด้วยเช็คและเงินสดย่อย ตามที่ทดลองบน FlowAccount (24-10-2026)
-- เช็ค: ใบที่ 1 วันที่จ่าย Dr เจ้าหนี้ / Cr 21329.NN เช็คจ่าย(ต่อบัญชีธนาคาร) · ใบที่ 2 วันที่ถูกตัดบัญชี Dr 21329.NN / Cr บัญชีธนาคาร
-- เงินสดย่อย: Cr 11149.NN (เปิดต่อวงเงิน) · ค่าธรรมเนียมเช็ค/เช็คเด้ง/วงเงินเกิน ยังไม่ทดสอบ → ปฏิเสธหรือไม่ตรวจ

create table petty_funds (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id),
  fund_name text not null, credit_limit numeric(18,2) not null check (credit_limit >= 0),
  responsible text, note text, is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create function create_petty_fund(p_name text, p_limit numeric, p_responsible text default null, p_note text default null)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid(); v_acc uuid := gen_random_uuid(); n int;
begin
  if coalesce(btrim(p_name), '') = '' then raise exception 'ต้องระบุชื่อวงเงินสดย่อย'; end if;
  select count(*) + 1 into n from petty_funds;
  insert into accounts(id, code, name, type) values (v_acc, '11149.' || lpad(n::text, 2, '0'), 'เงินสดย่อย - ' || p_name, 'asset');
  insert into petty_funds(id, account_id, fund_name, credit_limit, responsible, note) values (v_id, v_acc, p_name, p_limit, p_responsible, p_note);
  return v_id;
end $$;

-- บัญชีเช็คจ่าย: 1 บัญชีธนาคาร = 1 บัญชี 21329.NN (เปิดเมื่อใช้ครั้งแรก)
create table cheque_accounts (
  bank_account_id uuid primary key references bank_accounts(id),
  account_id uuid not null references accounts(id)
);
create function cheque_account_code(p_bank uuid) returns text language plpgsql as $$
declare v_acc uuid; v_code text; b bank_accounts; n int;
begin
  select a.code into v_code from cheque_accounts c join accounts a on a.id = c.account_id where c.bank_account_id = p_bank;
  if v_code is not null then return v_code; end if;
  select * into b from bank_accounts where id = p_bank and is_active;
  if not found then raise exception 'เช็คต้องเลือกบัญชีเช็คจ่าย'; end if;
  select count(*) + 1 into n from cheque_accounts;
  v_acc := gen_random_uuid(); v_code := '21329.' || lpad(n::text, 2, '0');
  insert into accounts(id, code, name, type) values (v_acc, v_code, 'เช็คจ่าย - ' || b.bank_name || ' ' || b.account_no, 'liability');
  insert into cheque_accounts values (p_bank, v_acc);
  return v_code;
end $$;

alter table purchase_payments drop constraint purchase_payments_method_check;
alter table purchase_payments add constraint purchase_payments_method_check check (method in ('cash','transfer','card','petty','cheque'));
alter table purchase_payments add column petty_fund_id uuid references petty_funds(id),
  add column cheque_no text, add column cheque_date date, add column clear_date date,
  add column clear_voucher_id uuid references journal_vouchers(id);

create or replace function record_purchase_payments(p_type text, p_doc uuid, p_date date, p_payments jsonb, p_net numeric,
  p_default_account text default '11112') returns jsonb language plpgsql as $$
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
  if v_sum <> p_net then raise exception 'ยอดรวมช่องทางจ่าย % ไม่เท่ายอดจ่ายสุทธิ %', v_sum, p_net; end if;
  return v_lines;
end $$;

-- กลับรายการใบตัดเช็คทั้งหมดของเอกสาร แล้วล้างช่องทางจ่าย (ใช้ตอนรีเซ็ต/ยกเลิกเอกสารที่จ่ายแล้ว)
create function clear_purchase_payments(p_type text, p_doc uuid) returns void language plpgsql as $$
declare r purchase_payments;
begin
  for r in select * from purchase_payments where doc_type = p_type and doc_id = p_doc and clear_voucher_id is not null loop
    perform reverse_voucher(r.clear_voucher_id);
  end loop;
  delete from purchase_payments where doc_type = p_type and doc_id = p_doc;
end $$;

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
    update goods_receipts set pv_voucher_id = null where id = p_id;
  elsif r.status = 'rejected' then
    update goods_receipts set uv_voucher_id = ri_post_uv(r) where id = p_id;
    perform stock_in(g.product_id, g.warehouse_id, g.qty, g.net, r.ri_date, 'RI', p_id, r.ri_no)
       from goods_receipt_lines g where g.ri_id = p_id order by g.line_no;
  end if;
  update goods_receipts set status = 'unpaid' where id = p_id;
end $$;

create or replace function reset_expense(p_id uuid) returns void language plpgsql as $$
declare e expenses;
begin
  select * into e from expenses where id = p_id for update;
  if not found or e.status not in ('approved','paid','rejected') then raise exception 'รีเซ็ตได้เฉพาะค่าใช้จ่ายที่อนุมัติหรือชำระแล้ว หรือไม่อนุมัติ'; end if;
  if e.status = 'paid' then
    perform reverse_voucher(e.pv_voucher_id);
    perform clear_purchase_payments('EXP', p_id);
    update wht_certs set status = 'cancelled' where expense_id = p_id and status = 'active';
    update expenses set pv_voucher_id = null, paid_date = null where id = p_id;
  elsif e.status = 'rejected' then
    update expenses set uv_voucher_id = exp_post_uv(e) where id = p_id;
  end if;
  update expenses set status = 'pending' where id = p_id;
end $$;

create or replace function cancel_goods_receipt(p_id uuid) returns void language plpgsql as $$
declare r goods_receipts;
begin
  select * into r from goods_receipts where id = p_id for update;
  if not found or r.status = 'cancelled' then raise exception 'ไม่พบใบรับสินค้าหรือถูกยกเลิกแล้ว'; end if;
  if r.status <> 'rejected' then
    perform ri_void_stock(p_id);
    if r.pv_voucher_id is not null then
      perform reverse_voucher(r.pv_voucher_id);
      perform clear_purchase_payments('RI', p_id);
    end if;
    perform reverse_voucher(r.uv_voucher_id);
  end if;
  update goods_receipts set status = 'cancelled' where id = p_id;
end $$;

create or replace function cancel_expense(p_id uuid) returns void language plpgsql as $$
declare e expenses;
begin
  select * into e from expenses where id = p_id for update;
  if not found or e.status = 'cancelled' then raise exception 'ไม่พบค่าใช้จ่ายหรือถูกยกเลิกแล้ว'; end if;
  if e.status <> 'rejected' then
    if e.pv_voucher_id is not null then
      perform reverse_voucher(e.pv_voucher_id);
      perform clear_purchase_payments('EXP', p_id);
    end if;
    perform reverse_voucher(e.uv_voucher_id);
  end if;
  update wht_certs set status = 'cancelled' where expense_id = p_id and status = 'active';
  update expenses set status = 'cancelled' where id = p_id;
end $$;
