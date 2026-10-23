create table contacts (
  id            uuid primary key default gen_random_uuid(),
  business_name text,
  contact_name  text,
  tax_id        text,
  is_cash_default boolean not null default false,
  created_at    timestamptz not null default now(),
  check (btrim(coalesce(business_name,'')) <> '' or btrim(coalesce(contact_name,'')) <> ''),
  check (tax_id is null or tax_id ~ '^[0-9]{10}$' or tax_id ~ '^[0-9]{13}$')
);
create table sales_docs (
  id          uuid primary key default gen_random_uuid(),
  doc_type    text not null check (doc_type in ('QT','INV','CA','BL','CN','DN')),
  doc_no      text not null unique,
  doc_date    date not null,
  contact_id  uuid not null references contacts(id),
  status      text not null,
  price_mode  text not null default 'exclusive' check (price_mode in ('exclusive','inclusive')),
  vat_rate    numeric(5,2) not null default 7,
  subtotal    numeric(18,2) not null default 0,   -- มูลค่าก่อน VAT
  vat         numeric(18,2) not null default 0,
  total       numeric(18,2) not null default 0,
  ref_doc_id  uuid references sales_docs(id),     -- CN/DN → INV, INV → QT
  reason      text,                                -- เหตุผลใบลดหนี้
  wht_rate    numeric(5,2) not null default 0,         -- อัตราหัก ณ ที่จ่ายที่ลูกค้าหักเรา (แก้ที่ INV)
  is_deposit  boolean not null default false,          -- INV มัดจำ
  deposit_net numeric(18,2) not null default 0,        -- INV ฉบับสุดท้าย: มัดจำที่หักออก (ก่อน VAT)
  deposit_vat numeric(18,2) not null default 0,
  collect_voucher_id uuid references journal_vouchers(id),  -- CA: รายการเก็บเงิน
  voucher_id  uuid references journal_vouchers(id),
  created_at  timestamptz not null default now()
);
create index on sales_docs (doc_type, status);
create index on sales_docs (ref_doc_id);
create table sales_doc_lines (
  doc_id      uuid not null references sales_docs(id),
  line_no     int  not null,
  description text not null,
  item_kind   text not null default 'service' check (item_kind in ('service','goods')),
  qty         numeric(18,4) not null check (qty > 0),
  unit_price  numeric(18,2) not null check (unit_price >= 0),
  amount      numeric(18,2) not null,
  primary key (doc_id, line_no)
);
create table billing_note_items (
  billing_id uuid not null references sales_docs(id),
  invoice_id uuid not null references sales_docs(id),
  primary key (billing_id, invoice_id)
);
create function sales_doc_has_active_receipt(p_doc uuid) returns boolean
language sql stable as $$ select false $$;
create function ensure_cash_contact() returns uuid language plpgsql as $$
declare v_id uuid;
begin
  select id into v_id from contacts where is_cash_default limit 1;
  if v_id is null then
    insert into contacts(business_name, is_cash_default) values ('Cash Sale', true) returning id into v_id;
  end if;
  return v_id;
end $$;
create function create_sales_doc(
  p_type text, p_date date, p_contact uuid, p_lines jsonb,
  p_price_mode text default 'exclusive', p_vat_rate numeric default 7,
  p_ref uuid default null, p_reason text default null,
  p_deposit_net numeric default 0, p_deposit_vat numeric default 0
) returns uuid language plpgsql as $$
declare
  v_id uuid := gen_random_uuid(); v_contact uuid := p_contact; v_status text;
  l jsonb; n int := 0; v_amt numeric; v_kind text;
  v_goods numeric := 0; v_serv numeric := 0; v_gross numeric;
  v_net numeric; v_net_goods numeric; v_net_serv numeric; v_vat numeric; v_total numeric;
  v_ref sales_docs; v_voucher uuid; v_lines jsonb := '[]'::jsonb;
  v_vtype text; v_rev_cr jsonb := '[]'::jsonb;
begin
  if p_type not in ('QT','INV','CA','CN','DN') then
    raise exception 'ประเภทเอกสาร % สร้างด้วยฟังก์ชันนี้ไม่ได้', p_type;
  end if;
  if p_lines is null or jsonb_array_length(p_lines) = 0 then raise exception 'ต้องมีรายการอย่างน้อย 1 บรรทัด'; end if;
  if p_type = 'CA' and v_contact is null then v_contact := ensure_cash_contact(); end if;
  if v_contact is null then raise exception 'ต้องระบุลูกค้า'; end if;
  if p_type in ('CN','DN') then
    if p_ref is null then raise exception 'ใบ % ต้องอ้างอิงใบแจ้งหนี้', p_type; end if;
    select * into v_ref from sales_docs where id = p_ref;
    if not found or v_ref.doc_type <> 'INV' or v_ref.status = 'cancelled' then
      raise exception 'เอกสารอ้างอิงต้องเป็นใบแจ้งหนี้ที่ยังไม่ถูกยกเลิก';
    end if;
    v_contact := v_ref.contact_id;
    p_price_mode := v_ref.price_mode; p_vat_rate := v_ref.vat_rate;
  end if;
  if p_type = 'CN' then
    if btrim(coalesce(p_reason,'')) = '' then raise exception 'ใบลดหนี้ต้องระบุเหตุผล'; end if;
    if sales_doc_has_active_receipt(p_ref) then raise exception 'ใบแจ้งหนี้นี้มีใบเสร็จผูกอยู่ ออกใบลดหนี้ไม่ได้'; end if;
  end if;
  if p_type = 'DN' and v_ref.status <> 'awaiting_payment' then
    raise exception 'ออกใบเพิ่มหนี้ได้เฉพาะใบแจ้งหนี้สถานะรอเก็บเงิน';  -- สันนิษฐาน: ต้นแบบทดสอบแค่กรณีนี้
  end if;
  for l in select * from jsonb_array_elements(p_lines) loop
    v_kind := line_kind(l);
    v_amt := round((l->>'qty')::numeric * (l->>'unit_price')::numeric, 2);
    if v_kind = 'goods' then v_goods := v_goods + v_amt; else v_serv := v_serv + v_amt; end if;
  end loop;
  v_gross := v_goods + v_serv;
  if p_price_mode = 'exclusive' then
    v_net := v_gross; v_net_goods := v_goods; v_net_serv := v_serv;
    v_vat := round(v_gross * p_vat_rate / 100, 2); v_total := v_gross + v_vat;
  else
    v_total := v_gross;
    v_net := round(v_gross * 100 / (100 + p_vat_rate), 2); v_vat := v_total - v_net;
    v_net_goods := round(v_goods * 100 / (100 + p_vat_rate), 2); v_net_serv := v_net - v_net_goods;
  end if;
  if p_deposit_net > 0 then   -- INV ฉบับสุดท้ายหลังมัดจำ (DEP-02)
    if p_type <> 'INV' then raise exception 'หักมัดจำได้เฉพาะใบแจ้งหนี้'; end if;
    v_vat := v_vat - p_deposit_vat;
    v_total := v_net + v_vat - p_deposit_net;
  end if;
  if p_type = 'CN' and v_total > v_ref.total - coalesce((
       select sum(total) from sales_docs where ref_doc_id = p_ref and doc_type = 'CN' and status <> 'cancelled'), 0) then
    raise exception 'ยอดใบลดหนี้เกินยอดใบแจ้งหนี้ที่เหลือ';  -- สันนิษฐาน: ป้องกันลดหนี้เกิน
  end if;
  v_status := case p_type when 'QT' then 'pending_approval' when 'INV' then 'awaiting_payment'
                          when 'CA' then 'pending_collect'  when 'CN' then 'approved' else 'active' end;
  insert into sales_docs(id, doc_type, doc_no, doc_date, contact_id, status, price_mode, vat_rate,
                         subtotal, vat, total, ref_doc_id, reason, deposit_net, deposit_vat)
  values (v_id, p_type, next_doc_no(p_type, p_date, true), p_date, v_contact, v_status, p_price_mode, p_vat_rate,
          v_net, v_vat, v_total, p_ref, p_reason, p_deposit_net, p_deposit_vat);
  for l in select * from jsonb_array_elements(p_lines) loop
    n := n + 1;
    insert into sales_doc_lines(doc_id, line_no, description, item_kind, qty, unit_price, amount, product_id, warehouse_id)
    values (v_id, n, l->>'description', line_kind(l), (l->>'qty')::numeric,
            (l->>'unit_price')::numeric, round((l->>'qty')::numeric * (l->>'unit_price')::numeric, 2),
            nullif(l->>'product_id','')::uuid, nullif(l->>'warehouse_id','')::uuid);
  end loop;
  if p_type in ('INV','CA','DN') then
    v_rev_cr := '[]'::jsonb;
    if p_type = 'DN' then   -- ใบเพิ่มหนี้ลงรายได้ 41210 ตามต้นแบบ
      v_rev_cr := jsonb_build_array(jsonb_build_object('account','41210','credit',v_net));
    else
      if v_net_goods > 0 then v_rev_cr := v_rev_cr || jsonb_build_object('account','41110','credit',v_net_goods); end if;
      if v_net_serv  > 0 then v_rev_cr := v_rev_cr || jsonb_build_object('account','41210','credit',v_net_serv);  end if;
    end if;
    if v_vat > 0 then v_rev_cr := v_rev_cr || jsonb_build_object('account','27111','credit',v_vat); end if;
    v_lines := jsonb_build_array(jsonb_build_object('account', case p_type when 'CA' then '11319' else '11311' end,
                                                    'debit', v_total))
               || (case when p_deposit_net > 0
                        then jsonb_build_array(jsonb_build_object('account','21921','debit',p_deposit_net))
                        else '[]'::jsonb end)
               || v_rev_cr;
    v_vtype := case p_type when 'CA' then 'RV' else 'SV' end;
  elsif p_type = 'CN' then
    v_lines := jsonb_build_array(jsonb_build_object('account','41400','debit',v_net));
    if v_vat > 0 then v_lines := v_lines || jsonb_build_object('account','27111','debit',v_vat); end if;
    v_lines := v_lines || jsonb_build_object('account','11311','credit',v_total);
    v_vtype := 'SV';
  end if;
  if v_vtype is not null then
    v_voucher := post_voucher(v_vtype, p_date, null, p_type, v_id::text, v_lines);
    update sales_docs set voucher_id = v_voucher where id = v_id;
  end if;
  if p_type in ('INV','CA') then perform stock_issue_for_doc(v_id); end if;
  if p_type = 'DN' then update sales_docs set status = 'awaiting_payment' where id = p_ref; end if;
  return v_id;
end $$;
create function approve_quotation(p_id uuid) returns void language plpgsql as $$
begin
  update sales_docs set status = 'approved' where id = p_id and doc_type = 'QT' and status = 'pending_approval';
  if not found then raise exception 'อนุมัติได้เฉพาะใบเสนอราคาที่รออนุมัติ'; end if;
end $$;
create function quotation_to_invoice(p_qt uuid, p_date date) returns uuid language plpgsql as $$
declare q sales_docs; v_inv uuid; v_lines jsonb;
begin
  select * into q from sales_docs where id = p_qt and doc_type = 'QT';
  if not found or q.status <> 'approved' then raise exception 'ต้องเป็นใบเสนอราคาที่อนุมัติแล้ว'; end if;
  select jsonb_agg(jsonb_build_object('description',description,'kind',item_kind,'qty',qty,'unit_price',unit_price,'product_id',product_id,'warehouse_id',warehouse_id) order by line_no)
    into v_lines from sales_doc_lines where doc_id = p_qt;
  v_inv := create_sales_doc('INV', p_date, q.contact_id, v_lines, q.price_mode, q.vat_rate, p_qt);
  update sales_docs set status = 'converted' where id = p_qt;
  return v_inv;
end $$;
create function create_billing_note(p_date date, p_contact uuid, p_invoices uuid[]) returns uuid
language plpgsql as $$
declare v_id uuid := gen_random_uuid(); i uuid; v_total numeric := 0; d sales_docs;
begin
  if p_invoices is null or array_length(p_invoices,1) is null then raise exception 'ต้องเลือกใบแจ้งหนี้อย่างน้อย 1 ใบ'; end if;
  foreach i in array p_invoices loop
    select * into d from sales_docs where id = i and doc_type = 'INV' and status = 'awaiting_payment' and contact_id = p_contact;
    if not found then raise exception 'ใบแจ้งหนี้ที่เลือกต้องเป็นของลูกค้าเดียวกันและรอเก็บเงิน'; end if;
    v_total := v_total + d.total;
  end loop;
  insert into sales_docs(id, doc_type, doc_no, doc_date, contact_id, status, subtotal, vat, total)
  values (v_id, 'BL', next_doc_no('BL', p_date, true), p_date, p_contact, 'billed', v_total, 0, v_total);
  insert into billing_note_items select v_id, unnest(p_invoices);
  return v_id;
end $$;
create function cancel_sales_doc(p_id uuid) returns void language plpgsql as $$
declare d sales_docs; q sales_docs;
begin
  select * into d from sales_docs where id = p_id for update;
  if not found then raise exception 'ไม่พบเอกสาร'; end if;
  if d.status = 'cancelled' then raise exception 'เอกสารถูกยกเลิกแล้ว'; end if;
  if sales_doc_has_active_receipt(d.id) then
    raise exception 'เอกสารมีใบเสร็จผูกอยู่ ต้องยกเลิกใบเสร็จก่อน';  -- สันนิษฐาน (ต้นแบบทดสอบเฉพาะบางกรณี)
  end if;
  if d.doc_type = 'INV' then
    if exists (select 1 from sales_docs where ref_doc_id = d.id and doc_type = 'DN' and status <> 'cancelled') then
      raise exception 'ใบแจ้งหนี้มีใบเพิ่มหนี้ผูกอยู่ ต้องยกเลิกใบเพิ่มหนี้ก่อน';
    end if;
    if exists (select 1 from sales_docs where ref_doc_id = d.id and doc_type = 'CN' and status <> 'cancelled') then
      raise exception 'ใบแจ้งหนี้มีใบลดหนี้ผูกอยู่ ต้องยกเลิกใบลดหนี้ก่อน';  -- สันนิษฐาน
    end if;
    if d.is_deposit and exists (select 1 from sales_docs where ref_doc_id = d.ref_doc_id and deposit_net > 0 and status <> 'cancelled') then
      raise exception 'ต้องยกเลิกใบแจ้งหนี้ฉบับสุดท้ายก่อน';  -- สันนิษฐาน
    end if;
  end if;
  if d.doc_type in ('INV','CA') then perform stock_return_for_doc(d.id); end if;
  if d.collect_voucher_id is not null then perform reverse_voucher(d.collect_voucher_id); end if;
  if d.voucher_id is not null then perform reverse_voucher(d.voucher_id); end if;
  update sales_docs set status = 'cancelled' where id = d.id;
  if d.doc_type = 'INV' and d.ref_doc_id is not null then
    select * into q from sales_docs where id = d.ref_doc_id and doc_type = 'QT';
    if found then
      if d.is_deposit then update sales_docs set status = 'approved' where id = q.id;
      elsif d.deposit_net > 0 then update sales_docs set status = 'deposit_paid' where id = q.id;
      end if;
    end if;
  end if;
end $$;
