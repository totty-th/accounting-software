create table purchase_orders (
  id uuid primary key default gen_random_uuid(),
  po_no text not null unique, po_date date not null, contact_id uuid not null references contacts(id),
  status text not null default 'pending' check (status in ('pending','approved','rejected','converted','cancelled')),
  subtotal numeric(18,2) not null default 0, vat numeric(18,2) not null default 0, total numeric(18,2) not null default 0,
  ri_id uuid references goods_receipts(id), note text,
  created_at timestamptz not null default now()
);
create table purchase_order_lines (
  po_id uuid not null references purchase_orders(id), line_no int not null,
  product_id uuid not null references products(id), warehouse_id uuid references warehouses(id),
  qty numeric(18,4) not null check (qty > 0), unit_price numeric(18,2) not null check (unit_price >= 0),
  vat_rate numeric(5,2) not null default 7, net numeric(18,2) not null, vat numeric(18,2) not null,
  primary key (po_id, line_no)
);
alter table goods_receipts add column po_id uuid references purchase_orders(id), add column ref_no text;
create function create_purchase_order(p_date date, p_contact uuid, p_lines jsonb, p_price_mode text default 'exclusive')
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid(); l jsonb; n int := 0; pr products;
        v_gross numeric; v_net numeric; v_vat numeric; v_vr numeric; t_net numeric := 0; t_vat numeric := 0;
begin
  if p_lines is null or jsonb_array_length(p_lines) = 0 then raise exception 'ต้องมีรายการอย่างน้อย 1 บรรทัด'; end if;
  insert into purchase_orders(id, po_no, po_date, contact_id) values (v_id, next_doc_no('PO', p_date, true), p_date, p_contact);
  for l in select * from jsonb_array_elements(p_lines) loop
    n := n + 1;
    select * into pr from products where id = (l->>'product_id')::uuid;
    if not found or pr.kind <> 'goods_stock' then raise exception 'ใบสั่งซื้อรับได้เฉพาะสินค้านับสต็อก'; end if;
    v_vr := coalesce((l->>'vat_rate')::numeric, 7);
    v_gross := round((l->>'qty')::numeric * (l->>'unit_price')::numeric, 2);
    if p_price_mode = 'exclusive' then v_net := v_gross; v_vat := round(v_net * v_vr / 100, 2);
    else v_net := round(v_gross * 100 / (100 + v_vr), 2); v_vat := v_gross - v_net; end if;
    insert into purchase_order_lines values (v_id, n, pr.id, nullif(l->>'warehouse_id','')::uuid,
      (l->>'qty')::numeric, (l->>'unit_price')::numeric, v_vr, v_net, v_vat);
    t_net := t_net + v_net; t_vat := t_vat + v_vat;
  end loop;
  update purchase_orders set subtotal = t_net, vat = t_vat, total = t_net + t_vat where id = v_id;
  return v_id;
end $$;
create function approve_purchase_order(p_id uuid) returns void language plpgsql as $$
begin
  update purchase_orders set status = 'approved' where id = p_id and status = 'pending';
  if not found then raise exception 'อนุมัติได้เฉพาะใบสั่งซื้อที่รออนุมัติ'; end if;
end $$;
create function reject_purchase_order(p_id uuid) returns void language plpgsql as $$
begin
  update purchase_orders set status = 'rejected' where id = p_id and status in ('pending','approved');
  if not found then raise exception 'ไม่อนุมัติได้เฉพาะใบสั่งซื้อที่รออนุมัติหรืออนุมัติแล้ว'; end if;
end $$;
create function reset_purchase_order(p_id uuid) returns void language plpgsql as $$
declare po purchase_orders;
begin
  select * into po from purchase_orders where id = p_id for update;
  if not found then raise exception 'ไม่พบใบสั่งซื้อ'; end if;
  if po.status = 'converted' then raise exception 'รีเซ็ตใบสั่งซื้อที่ดำเนินการแล้วยังไม่รองรับ (ยังไม่ทดสอบ)'; end if;
  if po.status not in ('approved','rejected') then raise exception 'รีเซ็ตได้เฉพาะใบสั่งซื้อที่อนุมัติหรือไม่อนุมัติ'; end if;
  update purchase_orders set status = 'pending' where id = p_id;
end $$;
create function cancel_purchase_order(p_id uuid) returns void language plpgsql as $$
begin
  update purchase_orders set status = 'cancelled' where id = p_id and status in ('pending','approved','rejected');
  if not found then raise exception 'ยกเลิกได้เฉพาะใบสั่งซื้อที่ยังไม่ดำเนินการ'; end if;
end $$;
create function upgrade_po_to_ri(p_id uuid, p_date date default null) returns uuid language plpgsql as $$
declare po purchase_orders; v_ri uuid; v_lines jsonb;
begin
  select * into po from purchase_orders where id = p_id for update;
  if not found or po.status not in ('pending','approved') then raise exception 'สร้างใบรับสินค้าได้เฉพาะใบสั่งซื้อที่รออนุมัติหรืออนุมัติแล้ว'; end if;
  select jsonb_agg(jsonb_build_object('product_id', product_id, 'warehouse_id', warehouse_id, 'qty', qty,
           'unit_price', unit_price, 'vat_rate', vat_rate) order by line_no)
    into v_lines from purchase_order_lines where po_id = p_id;
  v_ri := create_goods_receipt(coalesce(p_date, po.po_date), po.contact_id, v_lines);
  update goods_receipts set po_id = p_id, ref_no = po.po_no where id = v_ri;
  update purchase_orders set status = 'converted', ri_id = v_ri where id = p_id;
  return v_ri;
end $$;
create table payment_slips (
  id uuid primary key default gen_random_uuid(),
  pay_no text not null unique, pay_date date not null, due_date date,
  preparer text, requester text, approver text, reason text,
  status text not null default 'active' check (status in ('active','cancelled')),
  created_at timestamptz not null default now()
);
create table payment_slip_items (
  slip_id uuid not null references payment_slips(id), line_no int not null,
  doc_type text not null check (doc_type in ('EXP','RI')), doc_id uuid not null,
  primary key (slip_id, line_no)
);
create function slip_doc_info(p_type text, p_id uuid)
returns table (contact_id uuid, doc_no text, doc_date date, due_date date, gross numeric, wht numeric, net numeric, paid boolean, payable boolean)
language sql stable as $$
  select e.contact_id, e.exp_no, e.exp_date, e.due_date, e.total, e.wht_total, e.total - e.wht_total, e.status = 'paid',
         e.status in ('pending','approved')
    from expenses e where p_type = 'EXP' and e.id = p_id
  union all
  select g.contact_id, g.ri_no, g.ri_date, g.due_date, g.total, 0::numeric, g.total, g.status = 'paid', g.status in ('unpaid','approved')
    from goods_receipts g where p_type = 'RI' and g.id = p_id
$$;
create function create_payment_slip(p_date date, p_due date, p_docs jsonb, p_preparer text default null,
  p_requester text default null, p_approver text default null, p_reason text default null) returns uuid
language plpgsql as $$
declare v_id uuid := gen_random_uuid(); d jsonb; n int := 0; i record;
begin
  if p_docs is null or jsonb_array_length(p_docs) = 0 then raise exception 'ต้องเลือกเอกสารอย่างน้อย 1 รายการ'; end if;
  insert into payment_slips(id, pay_no, pay_date, due_date, preparer, requester, approver, reason)
  values (v_id, next_doc_no('PAY', p_date, true), p_date, p_due, p_preparer, p_requester, p_approver, p_reason);
  for d in select * from jsonb_array_elements(p_docs) loop
    select * into i from slip_doc_info(d->>'type', (d->>'id')::uuid);
    if not found then raise exception 'ไม่พบเอกสารที่เลือก'; end if;
    if not i.payable then raise exception 'เอกสาร % จ่ายไม่ได้ (ต้องรออนุมัติหรืออนุมัติแล้ว และยังไม่จ่าย)', i.doc_no; end if;
    if exists (select 1 from payment_slip_items x join payment_slips s on s.id = x.slip_id
                where s.status = 'active' and x.doc_type = d->>'type' and x.doc_id = (d->>'id')::uuid) then
      raise exception 'เอกสาร % อยู่ในใบเตรียมจ่ายอื่นแล้ว', i.doc_no;
    end if;
    n := n + 1;
    insert into payment_slip_items values (v_id, n, d->>'type', (d->>'id')::uuid);
  end loop;
  return v_id;
end $$;
create function pay_payment_slip_vendor(p_slip uuid, p_contact uuid, p_date date, p_payments jsonb default null)
returns int language plpgsql as $$
declare s payment_slips; it record; i record; v_total numeric := 0; v_sum numeric := 0; n int := 0;
        v_rows jsonb; v_rem numeric[] := '{}'; v_idx int; v_need numeric; v_take numeric; v_out jsonb; r jsonb;
begin
  select * into s from payment_slips where id = p_slip for update;
  if not found or s.status <> 'active' then raise exception 'ไม่พบใบเตรียมจ่ายหรือถูกยกเลิกแล้ว'; end if;
  for it in select x.* from payment_slip_items x where x.slip_id = p_slip order by x.line_no loop
    select * into i from slip_doc_info(it.doc_type, it.doc_id);
    if i.contact_id = p_contact and i.payable then v_total := v_total + i.net; end if;
  end loop;
  if v_total = 0 then raise exception 'ไม่มีเอกสารค้างจ่ายของผู้จำหน่ายนี้ในใบเตรียมจ่าย'; end if;
  if p_payments is not null and jsonb_array_length(p_payments) > 0 then
    v_rows := p_payments;
    for r in select * from jsonb_array_elements(v_rows) loop
      v_rem := v_rem || (r->>'amount')::numeric; v_sum := v_sum + (r->>'amount')::numeric;
    end loop;
    if v_sum <> v_total then raise exception 'ยอดรวมช่องทางจ่าย % ไม่เท่ายอดจ่ายสุทธิ %', v_sum, v_total; end if;
  end if;
  for it in select x.* from payment_slip_items x where x.slip_id = p_slip order by x.line_no loop
    select * into i from slip_doc_info(it.doc_type, it.doc_id);
    continue when i.contact_id <> p_contact or not i.payable;
    v_out := null;
    if v_rows is not null then   -- ตัดยอดจากแถวช่องทางตามลำดับจนครบยอดเอกสาร
      v_out := '[]'::jsonb; v_need := i.net; v_idx := 0;
      for r in select * from jsonb_array_elements(v_rows) loop
        v_idx := v_idx + 1;
        continue when v_rem[v_idx] <= 0 or v_need <= 0;
        v_take := least(v_rem[v_idx], v_need);
        v_out := v_out || jsonb_set(r, '{amount}', to_jsonb(v_take));
        v_rem[v_idx] := v_rem[v_idx] - v_take; v_need := v_need - v_take;
      end loop;
    end if;
    if it.doc_type = 'EXP' then perform pay_expense(it.doc_id, p_date, '11112', true, 'PND53', null, v_out);
    else perform pay_goods_receipt(it.doc_id, p_date, v_out); end if;
    n := n + 1;
  end loop;
  return n;
end $$;
create function cancel_payment_slip(p_id uuid) returns void language plpgsql as $$
declare it record;
begin
  perform 1 from payment_slips where id = p_id and status = 'active' for update;
  if not found then raise exception 'ไม่พบใบเตรียมจ่ายหรือถูกยกเลิกแล้ว'; end if;
  for it in select * from payment_slip_items where slip_id = p_id loop
    if (select paid from slip_doc_info(it.doc_type, it.doc_id)) then
      raise exception 'ยกเลิกไม่ได้: มีเอกสารที่จ่ายแล้ว (ยังไม่ทดสอบกรณีจ่ายบางส่วน)';
    end if;
  end loop;
  update payment_slips set status = 'cancelled' where id = p_id;
end $$;
