-- M3 รับเงิน/มัดจำ: ใบเสร็จ (RE) จาก INV, ใบเสร็จรวม, ใบเสร็จรับเงินอื่นๆ, เก็บเงิน CA, มัดจำ, WHT ฝั่งรับ
-- อ้างอิงสเปก RCV-01 ถึง RCV-07, DEP-01 ถึง DEP-04, D-04 (ยกเลิกใบเสร็จแล้วสถานะ INV ย้อนกลับ)

create table receipts (
  id           uuid primary key default gen_random_uuid(),
  receipt_no   text not null unique,
  kind         text not null check (kind in ('invoice','combined','other')),
  receipt_date date not null,
  contact_id   uuid not null references contacts(id),
  status       text not null default 'pending' check (status in ('pending','collected','cancelled')),
  amount       numeric(18,2) not null check (amount > 0),   -- ยอดรวมก่อนหัก ณ ที่จ่าย
  wht          numeric(18,2) not null default 0,
  other_type   text,
  save_voucher_id    uuid references journal_vouchers(id),
  collect_voucher_id uuid references journal_vouchers(id),
  collected_date date,
  created_at   timestamptz not null default now()
);

create table receipt_items (
  receipt_id   uuid not null references receipts(id),
  line_no      int  not null,
  doc_id       uuid references sales_docs(id),  -- INV หรือ DN ที่รับชำระ
  description  text,
  amount       numeric(18,2) not null check (amount > 0),
  wht          numeric(18,2) not null default 0,
  account_code text,                            -- เฉพาะใบเสร็จอื่นๆ
  primary key (receipt_id, line_no)
);
create index on receipt_items (doc_id);

-- ประเภทใบเสร็จรับเงินอื่นๆ → บัญชีเครดิต (RCV-06)
create table other_receipt_types (
  code text primary key, label text not null, account_code text not null
);
insert into other_receipt_types values
  ('guarantee_return', 'คืนเงินประกัน', '11922'),
  ('advance',          'เงินทดรอง/รับคืนค่าใช้จ่าย', '21398'),
  ('customer_deposit', 'เงินมัดจำรับ', '21921'),
  ('vendor_deposit_return', 'รับคืนเงินมัดจำจากผู้ขาย', '11921'),
  ('donation',         'เงินบริจาค/สนับสนุน', '49910'),
  ('other_income',     'รายได้อื่น', '49990');

create or replace function sales_doc_has_active_receipt(p_doc uuid) returns boolean
language sql stable as $$
  select exists (select 1 from receipt_items ri join receipts r on r.id = ri.receipt_id
                  where ri.doc_id = p_doc and r.status <> 'cancelled');
$$;

create function doc_receipted(p_doc uuid) returns numeric language sql stable as $$
  select coalesce(sum(ri.amount), 0) from receipt_items ri join receipts r on r.id = ri.receipt_id
   where ri.doc_id = p_doc and r.status <> 'cancelled';
$$;

-- สถานะ INV ตามใบเสร็จที่ใช้งานอยู่ (D-04: ย้อนกลับเมื่อไม่เหลือใบเสร็จ)
create function recompute_invoice_status(p_inv uuid) returns void language plpgsql as $$
declare i sales_docs; v_paid numeric; v_due numeric;
begin
  select * into i from sales_docs where id = p_inv and doc_type = 'INV';
  if not found or i.status = 'cancelled' then return; end if;
  v_paid := doc_receipted(p_inv);
  v_due := i.total - coalesce((select sum(total) from sales_docs
                                where ref_doc_id = p_inv and doc_type = 'CN' and status <> 'cancelled'), 0);
  update sales_docs set status = case when v_paid <= 0 then 'awaiting_payment'
                                      when v_paid >= v_due then 'receipt_opened'
                                      else 'split_paid' end
   where id = p_inv;
end $$;

-- WHT ฝั่งรับ (RCV-07): แก้ได้ที่ INV เท่านั้น ก่อนมีใบเสร็จ
create function set_invoice_wht(p_inv uuid, p_rate numeric) returns void language plpgsql as $$
begin
  if p_rate < 0 or p_rate > 15 then raise exception 'อัตราหัก ณ ที่จ่ายไม่ถูกต้อง'; end if;
  if sales_doc_has_active_receipt(p_inv) then raise exception 'มีใบเสร็จแล้ว แก้อัตราหัก ณ ที่จ่ายไม่ได้'; end if;
  update sales_docs set wht_rate = p_rate where id = p_inv and doc_type = 'INV' and status <> 'cancelled';
  if not found then raise exception 'ไม่พบใบแจ้งหนี้'; end if;
end $$;

-- ส่วนแบ่ง WHT ของยอดที่รับ: ครั้งสุดท้าย (รับครบ) ได้ส่วนที่เหลือ ที่เหลือคิดตามสัดส่วน (สันนิษฐาน)
create function wht_share(p_inv uuid, p_amount numeric) returns numeric language plpgsql stable as $$
declare i sales_docs; v_total numeric; v_already numeric;
begin
  select * into i from sales_docs where id = p_inv;
  v_total := round(i.subtotal * i.wht_rate / 100, 2);
  if v_total = 0 then return 0; end if;
  if p_amount >= i.total - doc_receipted(p_inv) then
    select coalesce(sum(ri.wht),0) into v_already from receipt_items ri join receipts r on r.id = ri.receipt_id
     where ri.doc_id = p_inv and r.status <> 'cancelled';
    return v_total - v_already;
  end if;
  return round(v_total * p_amount / i.total, 2);
end $$;

create function post_receipt_save(p_receipt uuid) returns void language plpgsql as $$
declare r receipts; v uuid; v_lines jsonb;
begin
  select * into r from receipts where id = p_receipt;
  if r.kind = 'other' then
    v_lines := jsonb_build_array(jsonb_build_object('account','11319','debit',r.amount)) ||
      (select jsonb_agg(jsonb_build_object('account', account_code, 'credit', amount) order by line_no)
         from receipt_items where receipt_id = p_receipt);
  else
    v_lines := jsonb_build_array(jsonb_build_object('account','11319','debit',r.amount),
                                 jsonb_build_object('account','11311','credit',r.amount));
  end if;
  v := post_voucher('RV', r.receipt_date, null, 'RE', p_receipt::text, v_lines);
  update receipts set save_voucher_id = v where id = p_receipt;
end $$;

-- สร้างใบเสร็จจาก INV (รับเต็มหรือบางส่วน = แบ่งจ่าย)
create function create_receipt_from_invoice(p_inv uuid, p_date date, p_amount numeric default null)
returns uuid language plpgsql as $$
declare i sales_docs; v_id uuid := gen_random_uuid(); v_remain numeric; v_amt numeric; v_wht numeric;
begin
  select * into i from sales_docs where id = p_inv and doc_type = 'INV' for update;
  if not found or i.status not in ('awaiting_payment','split_paid') then
    raise exception 'ออกใบเสร็จได้เฉพาะใบแจ้งหนี้ที่รอเก็บเงินหรือแบ่งจ่าย';
  end if;
  if exists (select 1 from sales_docs where ref_doc_id = p_inv and doc_type = 'CN' and status <> 'cancelled') then
    raise exception 'ใบแจ้งหนี้ที่มีใบลดหนี้ ให้ออกเป็นใบเสร็จรวม';  -- ต้นแบบซ่อนเมนูใบเสร็จเดี่ยว
  end if;
  v_remain := i.total - doc_receipted(p_inv);
  v_amt := coalesce(p_amount, v_remain);
  if v_amt <= 0 or v_amt > v_remain then raise exception 'ยอดรับต้องมากกว่า 0 และไม่เกินยอดคงเหลือ %', v_remain; end if;
  v_wht := wht_share(p_inv, v_amt);
  insert into receipts(id, receipt_no, kind, receipt_date, contact_id, amount, wht)
  values (v_id, next_doc_no('RE', p_date, true), 'invoice', p_date, i.contact_id, v_amt, v_wht);
  insert into receipt_items(receipt_id, line_no, doc_id, amount, wht) values (v_id, 1, p_inv, v_amt, v_wht);
  perform post_receipt_save(v_id);
  perform recompute_invoice_status(p_inv);
  return v_id;
end $$;

-- ใบเสร็จรวม: ดึง DN ที่ผูกกับ INV เข้ามาอัตโนมัติ, หัก CN ที่มี (สันนิษฐานว่าหักสุทธิ)
create function create_combined_receipt(p_date date, p_contact uuid, p_invoices uuid[])
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid(); inv uuid; i sales_docs; dn sales_docs; n int := 0;
        v_amt numeric; v_wht numeric; v_tot numeric := 0; v_whts numeric := 0;
begin
  if p_invoices is null or array_length(p_invoices,1) is null then raise exception 'ต้องเลือกใบแจ้งหนี้อย่างน้อย 1 ใบ'; end if;
  insert into receipts(id, receipt_no, kind, receipt_date, contact_id, amount, wht)
  values (v_id, next_doc_no('RE', p_date, true), 'combined', p_date, p_contact, 1, 0);  -- ปรับยอดภายหลัง
  foreach inv in array p_invoices loop
    select * into i from sales_docs where id = inv and doc_type = 'INV' and contact_id = p_contact
       and status in ('awaiting_payment','split_paid');
    if not found then raise exception 'ใบแจ้งหนี้ที่เลือกต้องเป็นของลูกค้าเดียวกันและรอเก็บเงิน'; end if;
    v_amt := i.total - doc_receipted(inv) - coalesce((select sum(total) from sales_docs
               where ref_doc_id = inv and doc_type = 'CN' and status <> 'cancelled'), 0);
    if v_amt > 0 then
      v_wht := wht_share(inv, v_amt);
      n := n + 1;
      insert into receipt_items(receipt_id, line_no, doc_id, amount, wht) values (v_id, n, inv, v_amt, v_wht);
      v_tot := v_tot + v_amt; v_whts := v_whts + v_wht;
    end if;
    for dn in select * from sales_docs where ref_doc_id = inv and doc_type = 'DN' and status <> 'cancelled' loop
      v_amt := dn.total - doc_receipted(dn.id);
      if v_amt > 0 then
        n := n + 1;
        insert into receipt_items(receipt_id, line_no, doc_id, amount) values (v_id, n, dn.id, v_amt);
        v_tot := v_tot + v_amt;
      end if;
    end loop;
  end loop;
  if v_tot <= 0 then raise exception 'ไม่มียอดค้างรับ'; end if;
  update receipts set amount = v_tot, wht = v_whts where id = v_id;
  perform post_receipt_save(v_id);
  foreach inv in array p_invoices loop perform recompute_invoice_status(inv); end loop;
  return v_id;
end $$;

-- ใบเสร็จรับเงินอื่นๆ: p_lines = [{"description":"..","amount":500,"account":"optional"}]
-- account ระบุได้เฉพาะโหมดนักบัญชี (ถ้าไม่ระบุ ใช้บัญชีตามประเภท)
create function create_other_receipt(p_date date, p_contact uuid, p_type text, p_lines jsonb)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid(); t other_receipt_types; l jsonb; n int := 0; v_tot numeric := 0; v_acc text;
begin
  select * into t from other_receipt_types where code = p_type;
  if not found then raise exception 'ไม่รู้จักประเภทใบเสร็จ %', p_type; end if;
  if p_lines is null or jsonb_array_length(p_lines) = 0 then raise exception 'ต้องมีรายการอย่างน้อย 1 บรรทัด'; end if;
  insert into receipts(id, receipt_no, kind, receipt_date, contact_id, amount, other_type)
  values (v_id, next_doc_no('RE', p_date, true), 'other', p_date, p_contact, 1, p_type);
  for l in select * from jsonb_array_elements(p_lines) loop
    n := n + 1; v_acc := coalesce(l->>'account', t.account_code);
    insert into receipt_items(receipt_id, line_no, description, amount, account_code)
    values (v_id, n, l->>'description', (l->>'amount')::numeric, v_acc);
    v_tot := v_tot + (l->>'amount')::numeric;
  end loop;
  update receipts set amount = v_tot where id = v_id;
  perform post_receipt_save(v_id);
  return v_id;
end $$;

-- เก็บเงิน: Dr 11112 (สุทธิ) [+ Dr 17120 ภาษีถูกหัก] / Cr 11319
create function collect_receipt(p_id uuid, p_date date) returns void language plpgsql as $$
declare r receipts; v uuid; v_lines jsonb;
begin
  select * into r from receipts where id = p_id for update;
  if not found or r.status <> 'pending' then raise exception 'เก็บเงินได้เฉพาะใบเสร็จที่รอเก็บเงิน'; end if;
  v_lines := jsonb_build_array(jsonb_build_object('account','11112','debit', r.amount - r.wht));
  if r.wht > 0 then v_lines := v_lines || jsonb_build_object('account','17120','debit', r.wht); end if;
  v_lines := v_lines || jsonb_build_object('account','11319','credit', r.amount);
  v := post_voucher('RV', p_date, null, 'RE-COLLECT', p_id::text, v_lines);
  update receipts set status = 'collected', collect_voucher_id = v, collected_date = p_date where id = p_id;
end $$;

-- รีเซ็ต (เก็บแล้ว → รอเก็บ): ยกเลิกรายการเก็บเงิน เอกสารต้นทางไม่เปลี่ยน
create function reset_receipt(p_id uuid) returns void language plpgsql as $$
declare r receipts;
begin
  select * into r from receipts where id = p_id for update;
  if not found or r.status <> 'collected' then raise exception 'รีเซ็ตได้เฉพาะใบเสร็จที่เก็บเงินแล้ว'; end if;
  perform reverse_voucher(r.collect_voucher_id);
  update receipts set status = 'pending', collect_voucher_id = null, collected_date = null where id = p_id;
end $$;

-- ยกเลิก: ยกเลิกรายการทั้งสองใบ แล้วสถานะ INV ย้อนกลับตามใบเสร็จที่เหลือ (D-04)
create function cancel_receipt(p_id uuid) returns void language plpgsql as $$
declare r receipts; d uuid;
begin
  select * into r from receipts where id = p_id for update;
  if not found or r.status = 'cancelled' then raise exception 'ใบเสร็จถูกยกเลิกแล้วหรือไม่พบ'; end if;
  if r.collect_voucher_id is not null then perform reverse_voucher(r.collect_voucher_id); end if;
  perform reverse_voucher(r.save_voucher_id);
  update receipts set status = 'cancelled' where id = p_id;
  for d in select distinct doc_id from receipt_items where receipt_id = p_id and doc_id is not null loop
    perform recompute_invoice_status(d);
  end loop;
end $$;

-- ขายสด (CA): เก็บเงิน / รีเซ็ต
create function collect_cash_sale(p_id uuid, p_date date) returns void language plpgsql as $$
declare d sales_docs; v uuid;
begin
  select * into d from sales_docs where id = p_id and doc_type = 'CA' for update;
  if not found or d.status <> 'pending_collect' then raise exception 'เก็บเงินได้เฉพาะขายสดที่รอเก็บเงิน'; end if;
  v := post_voucher('RV', p_date, null, 'CA-COLLECT', p_id::text,
        jsonb_build_array(jsonb_build_object('account','11112','debit',d.total),
                          jsonb_build_object('account','11319','credit',d.total)));
  update sales_docs set status = 'collected', collect_voucher_id = v where id = p_id;
end $$;

create function reset_cash_sale(p_id uuid) returns void language plpgsql as $$
declare d sales_docs;
begin
  select * into d from sales_docs where id = p_id and doc_type = 'CA' for update;
  if not found or d.status <> 'collected' then raise exception 'รีเซ็ตได้เฉพาะขายสดที่เก็บเงินแล้ว'; end if;
  perform reverse_voucher(d.collect_voucher_id);
  update sales_docs set status = 'pending_collect', collect_voucher_id = null where id = p_id;
end $$;

-- มัดจำ (DEP-01): INV มัดจำจาก QT ที่อนุมัติแล้ว
create function create_deposit_invoice(p_qt uuid, p_date date, p_deposit_net numeric) returns uuid
language plpgsql as $$
declare q sales_docs; v_id uuid := gen_random_uuid(); v_vat numeric; v_total numeric; v uuid;
begin
  select * into q from sales_docs where id = p_qt and doc_type = 'QT' for update;
  if not found or q.status <> 'approved' then raise exception 'ต้องเป็นใบเสนอราคาที่อนุมัติแล้วและยังไม่มีมัดจำ'; end if;
  if p_deposit_net <= 0 or p_deposit_net > q.subtotal then raise exception 'ยอดมัดจำต้องมากกว่า 0 และไม่เกินมูลค่าใบเสนอราคา'; end if;
  v_vat := round(p_deposit_net * q.vat_rate / 100, 2); v_total := p_deposit_net + v_vat;
  insert into sales_docs(id, doc_type, doc_no, doc_date, contact_id, status, price_mode, vat_rate,
                         subtotal, vat, total, ref_doc_id, is_deposit)
  values (v_id, 'INV', next_doc_no('INV', p_date, true), p_date, q.contact_id, 'awaiting_payment', 'exclusive',
          q.vat_rate, p_deposit_net, v_vat, v_total, p_qt, true);
  insert into sales_doc_lines values (v_id, 1, 'เงินมัดจำ', 'service', 1, p_deposit_net, p_deposit_net);
  v := post_voucher('SV', p_date, null, 'INV', v_id::text, jsonb_build_array(
        jsonb_build_object('account','11311','debit',v_total),
        jsonb_build_object('account','21921','credit',p_deposit_net),
        jsonb_build_object('account','27111','credit',v_vat)));
  update sales_docs set voucher_id = v where id = v_id;
  update sales_docs set status = 'deposit_paid' where id = p_qt;
  return v_id;
end $$;

-- INV ฉบับสุดท้าย (DEP-02): แสดงการหักมัดจำ รายได้ลงเต็ม VAT ลงเฉพาะส่วนที่เหลือ
create function create_final_invoice(p_qt uuid, p_date date) returns uuid language plpgsql as $$
declare q sales_docs; dep sales_docs; v_lines jsonb; v_inv uuid;
begin
  select * into q from sales_docs where id = p_qt and doc_type = 'QT' for update;
  if not found or q.status <> 'deposit_paid' then raise exception 'ใบเสนอราคานี้ยังไม่มีมัดจำ'; end if;
  select * into dep from sales_docs where ref_doc_id = p_qt and is_deposit and status <> 'cancelled';
  if not found then raise exception 'ไม่พบใบแจ้งหนี้มัดจำที่ใช้งานอยู่'; end if;
  select jsonb_agg(jsonb_build_object('description',description,'kind',item_kind,'qty',qty,'unit_price',unit_price,'product_id',product_id,'warehouse_id',warehouse_id) order by line_no)
    into v_lines from sales_doc_lines where doc_id = p_qt;
  v_inv := create_sales_doc('INV', p_date, q.contact_id, v_lines, q.price_mode, q.vat_rate, p_qt, null,
                            dep.subtotal, dep.vat);
  update sales_docs set status = 'converted' where id = p_qt;
  return v_inv;
end $$;
