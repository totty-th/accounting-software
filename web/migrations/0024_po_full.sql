alter table purchase_orders
  add column due_date date, add column credit_days int not null default 0 check (credit_days >= 0),
  add column purchaser text, add column project text, add column ref_no text, add column description text,
  add column price_mode text not null default 'exclusive' check (price_mode in ('exclusive','inclusive')),
  add column warehouse_id uuid references warehouses(id),
  add column show_signature boolean not null default true,
  add column internal_note text,
  add column discount_total numeric(18,2) not null default 0,
  add column exempt_base numeric(18,2) not null default 0,
  add column wht_total numeric(18,2) not null default 0;
alter table purchase_order_lines
  add column description text, add column unit text,
  add column discount_type text not null default 'percent' check (discount_type in ('percent','amount')),
  add column discount_value numeric(18,2) not null default 0 check (discount_value >= 0),
  add column discount numeric(18,2) not null default 0,
  add column vat_exempt boolean not null default false,
  add column wht_rate numeric(5,2) not null default 0 check (wht_rate >= 0 and wht_rate <= 100),
  add column wht numeric(18,2) not null default 0;
alter table company_profile add column signature_img text, add column stamp_img text;
create function save_purchase_order(p_id uuid, p_header jsonb, p_lines jsonb) returns uuid language plpgsql as $$
declare v_id uuid := p_id; h jsonb := coalesce(p_header, '{}'); l jsonb; n int := 0; pr products; po purchase_orders;
        v_date date := (h->>'date')::date; v_mode text := coalesce(nullif(h->>'price_mode',''), 'exclusive');
        v_cd int := coalesce(nullif(h->>'credit_days','')::int, 0);
        v_gross numeric; v_disc numeric; v_after numeric; v_net numeric; v_vat numeric; v_vr numeric; v_ex boolean; v_wr numeric; v_dt text; v_dv numeric;
        t_net numeric := 0; t_vat numeric := 0; t_disc numeric := 0; t_ex numeric := 0; t_wht numeric := 0; v_wht numeric;
begin
  if p_lines is null or jsonb_array_length(p_lines) = 0 then raise exception 'ต้องมีรายการอย่างน้อย 1 บรรทัด'; end if;
  if v_mode not in ('exclusive','inclusive') then raise exception 'ราคาสินค้า % ไม่ถูกต้อง', v_mode; end if;
  if v_date is null then raise exception 'ต้องระบุวันที่'; end if;
  if nullif(h->>'contact','') is null then raise exception 'ต้องเลือกผู้จำหน่าย'; end if;
  if v_id is null then
    v_id := gen_random_uuid();
    insert into purchase_orders(id, po_no, po_date, contact_id) values (v_id, next_doc_no('PO', v_date, true), v_date, (h->>'contact')::uuid);
  else
    select * into po from purchase_orders where id = v_id for update;
    if not found then raise exception 'ไม่พบใบสั่งซื้อ'; end if;
    if po.status <> 'pending' then raise exception 'แก้ไขได้เฉพาะใบสั่งซื้อที่รออนุมัติ (แก้ใบที่อนุมัติแล้ว/ดำเนินการแล้วยังไม่ทดสอบบน FA)'; end if;
    delete from purchase_order_lines where po_id = v_id;
  end if;
  for l in select * from jsonb_array_elements(p_lines) loop
    n := n + 1;
    select * into pr from products where id = (l->>'product_id')::uuid;
    if not found or pr.kind <> 'goods_stock' then raise exception 'ใบสั่งซื้อรับได้เฉพาะสินค้านับสต็อก'; end if;
    v_ex := coalesce(l->>'vat', '7') = 'exempt';
    v_vr := case when v_ex then 0 else coalesce(nullif(l->>'vat','')::numeric, 7) end;
    if v_vr not in (0, 7) then raise exception 'ภาษี % ไม่รองรับ (7%% / 0%% / ยกเว้น)', l->>'vat'; end if;
    v_dt := coalesce(nullif(l->>'discount_type',''), 'percent'); v_dv := coalesce(nullif(l->>'discount_value','')::numeric, 0);
    if v_dt = 'percent' and v_dv > 100 then raise exception 'ส่วนลดเกิน 100%%'; end if;
    v_wr := coalesce(nullif(l->>'wht_rate','')::numeric, 0);
    v_gross := round((l->>'qty')::numeric * (l->>'unit_price')::numeric, 2);
    v_disc := case when v_dt = 'amount' then v_dv else round(v_gross * v_dv / 100, 2) end;
    if v_disc > v_gross then raise exception 'ส่วนลดเกินมูลค่ารายการ (บรรทัด %)', n; end if;
    v_after := v_gross - v_disc;
    if v_ex or v_vr = 0 then v_net := v_after; v_vat := 0;
    elsif v_mode = 'exclusive' then v_net := v_after; v_vat := round(v_net * v_vr / 100, 2);
    else v_net := round(v_after * 100 / (100 + v_vr), 2); v_vat := v_after - v_net; end if;
    v_wht := round(v_net * v_wr / 100, 2);
    insert into purchase_order_lines(po_id, line_no, product_id, warehouse_id, qty, unit_price, vat_rate, net, vat,
        description, unit, discount_type, discount_value, discount, vat_exempt, wht_rate, wht)
    values (v_id, n, pr.id, coalesce(nullif(l->>'warehouse_id','')::uuid, nullif(h->>'warehouse_id','')::uuid),
        (l->>'qty')::numeric, (l->>'unit_price')::numeric, v_vr, v_net, v_vat,
        nullif(l->>'description',''), coalesce(nullif(l->>'unit',''), pr.base_unit), v_dt, v_dv, v_disc, v_ex, v_wr, v_wht);
    t_net := t_net + v_net; t_vat := t_vat + v_vat; t_disc := t_disc + v_disc; t_wht := t_wht + v_wht;
    if v_ex then t_ex := t_ex + v_net; end if;
  end loop;
  update purchase_orders set po_date = v_date, contact_id = (h->>'contact')::uuid, credit_days = v_cd,
      due_date = coalesce(nullif(h->>'due_date','')::date, v_date + v_cd), purchaser = nullif(h->>'purchaser',''),
      project = nullif(h->>'project',''), ref_no = nullif(h->>'ref_no',''), description = nullif(h->>'description',''),
      price_mode = v_mode, warehouse_id = nullif(h->>'warehouse_id','')::uuid,
      show_signature = coalesce((h->>'show_signature')::boolean, true), note = nullif(h->>'note',''),
      internal_note = nullif(h->>'internal_note',''),
      subtotal = t_net, vat = t_vat, total = t_net + t_vat, discount_total = t_disc, exempt_base = t_ex, wht_total = t_wht
    where id = v_id;
  return v_id;
end $$;
create function duplicate_purchase_order(p_id uuid, p_date date default null) returns uuid language plpgsql as $$
declare po purchase_orders; v_lines jsonb;
begin
  select * into po from purchase_orders where id = p_id;
  if not found then raise exception 'ไม่พบใบสั่งซื้อ'; end if;
  select jsonb_agg(jsonb_build_object('product_id', product_id, 'warehouse_id', warehouse_id, 'description', description, 'unit', unit,
           'qty', qty, 'unit_price', unit_price, 'discount_type', discount_type, 'discount_value', discount_value,
           'vat', case when vat_exempt then 'exempt' else trim_scale(vat_rate)::text end, 'wht_rate', wht_rate) order by line_no)
    into v_lines from purchase_order_lines where po_id = p_id;
  return save_purchase_order(null, jsonb_build_object('date', coalesce(p_date, po.po_date), 'contact', po.contact_id,
    'credit_days', po.credit_days, 'purchaser', po.purchaser, 'project', po.project, 'ref_no', po.ref_no, 'description', po.description,
    'price_mode', po.price_mode, 'warehouse_id', po.warehouse_id, 'show_signature', po.show_signature, 'note', po.note,
    'internal_note', po.internal_note), v_lines);
end $$;
create or replace function upgrade_po_to_ri(p_id uuid, p_date date default null) returns uuid language plpgsql as $$
declare po purchase_orders; v_ri uuid; v_lines jsonb;
begin
  select * into po from purchase_orders where id = p_id for update;
  if not found or po.status not in ('pending','approved') then raise exception 'สร้างใบรับสินค้าได้เฉพาะใบสั่งซื้อที่รออนุมัติหรืออนุมัติแล้ว'; end if;
  if exists (select 1 from purchase_order_lines where po_id = p_id and discount > 0) then
    raise exception 'ใบสั่งซื้อที่มีส่วนลดแปลงเป็นใบรับสินค้ายังไม่รองรับ (ใบรับสินค้ายังไม่มีส่วนลด)';
  end if;
  select jsonb_agg(jsonb_build_object('product_id', product_id, 'warehouse_id', coalesce(warehouse_id, po.warehouse_id), 'qty', qty,
           'unit_price', unit_price, 'vat_rate', vat_rate) order by line_no)
    into v_lines from purchase_order_lines where po_id = p_id;
  v_ri := create_goods_receipt(coalesce(p_date, po.po_date), po.contact_id, v_lines, po.price_mode);
  update goods_receipts set po_id = p_id, ref_no = po.po_no, due_date = coalesce(po.due_date, due_date) where id = v_ri;
  update purchase_orders set status = 'converted', ri_id = v_ri where id = p_id;
  return v_ri;
end $$;
