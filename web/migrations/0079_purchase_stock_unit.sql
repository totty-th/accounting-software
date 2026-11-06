alter table purchase_order_lines add column stock_qty numeric(18,4) check (stock_qty is null or stock_qty > 0);
alter table goods_receipt_lines  add column stock_qty numeric(18,4) check (stock_qty is null or stock_qty > 0);
create function line_stock_qty(p_product uuid, p_unit text, p_stock text, p_line int) returns numeric language plpgsql stable as $$
declare v_base text; s numeric := nullif(btrim(coalesce(p_stock, '')), '')::numeric;
begin
  select base_unit into v_base from products where id = p_product;
  if nullif(btrim(coalesce(p_unit, '')), '') is null or lower(btrim(p_unit)) = lower(btrim(v_base)) then return null; end if;
  if s is null or s <= 0 then
    raise exception 'บรรทัด %: ซื้อเป็นหน่วย "%" ซึ่งไม่ใช่หน่วยสต็อก "%" — ต้องระบุจำนวน % ที่ได้รับจริง', p_line, btrim(p_unit), v_base, v_base;
  end if;
  return s;
end $$;
create or replace function save_purchase_order(p_id uuid, p_header jsonb, p_lines jsonb) returns uuid language plpgsql as $$
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
        description, unit, discount_type, discount_value, discount, vat_exempt, wht_rate, wht, stock_qty)
    values (v_id, n, pr.id, coalesce(nullif(l->>'warehouse_id','')::uuid, nullif(h->>'warehouse_id','')::uuid),
        (l->>'qty')::numeric, (l->>'unit_price')::numeric, v_vr, v_net, v_vat,
        nullif(l->>'description',''), coalesce(nullif(l->>'unit',''), pr.base_unit), v_dt, v_dv, v_disc, v_ex, v_wr, v_wht,
        line_stock_qty(pr.id, coalesce(nullif(l->>'unit',''), pr.base_unit), l->>'stock_qty', n));
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
create or replace function duplicate_purchase_order(p_id uuid, p_date date default null) returns uuid language plpgsql as $$
declare po purchase_orders; v_lines jsonb;
begin
  select * into po from purchase_orders where id = p_id;
  if not found then raise exception 'ไม่พบใบสั่งซื้อ'; end if;
  select jsonb_agg(jsonb_build_object('product_id', product_id, 'warehouse_id', warehouse_id, 'description', description, 'unit', unit,
           'qty', qty, 'stock_qty', stock_qty, 'unit_price', unit_price, 'discount_type', discount_type, 'discount_value', discount_value,
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
           'unit_price', unit_price, 'vat_rate', vat_rate, 'unit', unit, 'stock_qty', stock_qty) order by line_no)
    into v_lines from purchase_order_lines where po_id = p_id;
  v_ri := create_goods_receipt(coalesce(p_date, po.po_date), po.contact_id, v_lines, po.price_mode);
  update goods_receipts set po_id = p_id, ref_no = po.po_no, due_date = coalesce(po.due_date, due_date) where id = v_ri;
  update purchase_orders set status = 'converted', ri_id = v_ri where id = p_id;
  return v_ri;
end $$;
create or replace function create_goods_receipt(p_date date, p_contact uuid, p_lines jsonb, p_price_mode text default 'exclusive')
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid(); v_no text; l jsonb; n int := 0; pr products; wh uuid;
        v_gross numeric; v_net numeric; v_vat numeric; v_vr numeric; t_net numeric := 0; t_vat numeric := 0; v uuid;
        v_lines jsonb;
begin
  if p_lines is null or jsonb_array_length(p_lines) = 0 then raise exception 'ต้องมีรายการอย่างน้อย 1 บรรทัด'; end if;
  v_no := next_doc_no('RI', p_date, true);
  insert into goods_receipts(id, ri_no, ri_date, contact_id) values (v_id, v_no, p_date, p_contact);
  for l in select * from jsonb_array_elements(p_lines) loop
    n := n + 1;
    select * into pr from products where id = (l->>'product_id')::uuid;
    if not found or pr.kind <> 'goods_stock' then raise exception 'ใบรับสินค้ารับได้เฉพาะสินค้านับสต็อก'; end if;
    wh := coalesce(nullif(l->>'warehouse_id','')::uuid, main_warehouse());
    v_vr := coalesce((l->>'vat_rate')::numeric, 7);
    v_gross := round((l->>'qty')::numeric * (l->>'unit_price')::numeric, 2);
    if p_price_mode = 'exclusive' then v_net := v_gross; v_vat := round(v_net * v_vr / 100, 2);
    else v_net := round(v_gross * 100 / (100 + v_vr), 2); v_vat := v_gross - v_net; end if;
    insert into goods_receipt_lines(ri_id, line_no, product_id, warehouse_id, qty, unit_price, vat_rate, net, vat, unit, stock_qty)
    values (v_id, n, pr.id, wh, (l->>'qty')::numeric, (l->>'unit_price')::numeric, v_vr, v_net, v_vat,
            coalesce(nullif(l->>'unit',''), pr.base_unit), line_stock_qty(pr.id, coalesce(nullif(l->>'unit',''), pr.base_unit), l->>'stock_qty', n));
    t_net := t_net + v_net; t_vat := t_vat + v_vat;
  end loop;
  v_lines := jsonb_build_array(jsonb_build_object('account', sys_account('inventory'), 'debit', t_net));
  if t_vat > 0 then v_lines := v_lines || jsonb_build_object('account','17113','debit',t_vat); end if;
  v_lines := v_lines || jsonb_build_object('account','21311','credit', t_net + t_vat);
  v := post_voucher('UV', p_date, null, 'RI', v_id::text, v_lines);
  update goods_receipts set subtotal = t_net, vat = t_vat, total = t_net + t_vat, uv_voucher_id = v where id = v_id;
  perform stock_in(g.product_id, g.warehouse_id, coalesce(g.stock_qty, g.qty), g.net, p_date, 'RI', v_id, v_no)
     from goods_receipt_lines g where g.ri_id = v_id order by g.line_no;
  return v_id;
end $$;
create or replace function save_goods_receipt(p_header jsonb, p_lines jsonb) returns uuid language plpgsql as $$
declare h jsonb := coalesce(p_header, '{}'); l jsonb; n int := 0; pr products; c record; v_id uuid := gen_random_uuid(); v_no text; v uuid;
        v_date date := (h->>'date')::date; v_mode text := coalesce(nullif(h->>'price_mode',''), 'exclusive');
        v_cd int := coalesce(nullif(h->>'credit_days','')::int, 0); v_dt text; v_dv numeric; v_wr numeric; v_wht numeric; wh uuid;
        t_net numeric := 0; t_vat numeric := 0; t_disc numeric := 0; t_ex numeric := 0; t_wht numeric := 0; v_lines jsonb;
begin
  if p_lines is null or jsonb_array_length(p_lines) = 0 then raise exception 'ต้องมีรายการอย่างน้อย 1 บรรทัด'; end if;
  if v_mode not in ('exclusive','inclusive') then raise exception 'ราคาสินค้า % ไม่ถูกต้อง', v_mode; end if;
  if v_date is null then raise exception 'ต้องระบุวันที่'; end if;
  if nullif(h->>'contact','') is null then raise exception 'ต้องเลือกผู้จำหน่าย'; end if;
  v_no := next_doc_no('RI', v_date, true);
  insert into goods_receipts(id, ri_no, ri_date, contact_id) values (v_id, v_no, v_date, (h->>'contact')::uuid);
  for l in select * from jsonb_array_elements(p_lines) loop
    n := n + 1;
    select * into pr from products where id = (l->>'product_id')::uuid;
    if not found or pr.kind <> 'goods_stock' then raise exception 'ใบรับสินค้ารับได้เฉพาะสินค้านับสต็อก'; end if;
    v_dt := coalesce(nullif(l->>'discount_type',''), 'percent'); v_dv := coalesce(nullif(l->>'discount_value','')::numeric, 0);
    v_wr := coalesce(nullif(l->>'wht_rate','')::numeric, 0);
    select * into c from purchase_line_calc((l->>'qty')::numeric, (l->>'unit_price')::numeric, v_dt, v_dv, coalesce(l->>'vat','7'), v_mode);
    v_wht := round(c.v_net * v_wr / 100, 2);
    wh := coalesce(nullif(l->>'warehouse_id','')::uuid, nullif(h->>'warehouse_id','')::uuid, main_warehouse());
    insert into goods_receipt_lines(ri_id, line_no, product_id, warehouse_id, qty, unit_price, vat_rate, net, vat,
        description, unit, discount_type, discount_value, discount, vat_exempt, wht_rate, wht, stock_qty)
    values (v_id, n, pr.id, wh, (l->>'qty')::numeric, (l->>'unit_price')::numeric, c.v_rate, c.v_net, c.v_vat,
        nullif(l->>'description',''), coalesce(nullif(l->>'unit',''), pr.base_unit), v_dt, v_dv, c.v_disc, c.v_exempt, v_wr, v_wht,
        line_stock_qty(pr.id, coalesce(nullif(l->>'unit',''), pr.base_unit), l->>'stock_qty', n));
    t_net := t_net + c.v_net; t_vat := t_vat + c.v_vat; t_disc := t_disc + c.v_disc; t_wht := t_wht + v_wht;
    if c.v_exempt then t_ex := t_ex + c.v_net; end if;
  end loop;
  v_lines := jsonb_build_array(jsonb_build_object('account', sys_account('inventory'), 'debit', t_net));
  if t_vat > 0 then v_lines := v_lines || jsonb_build_object('account','17113','debit',t_vat); end if;
  v_lines := v_lines || jsonb_build_object('account','21311','credit', t_net + t_vat);
  v := post_voucher('UV', v_date, null, 'RI', v_id::text, v_lines);
  update goods_receipts set subtotal = t_net, vat = t_vat, total = t_net + t_vat, uv_voucher_id = v,
      credit_days = v_cd, due_date = coalesce(nullif(h->>'due_date','')::date, v_date + v_cd), purchaser = nullif(h->>'purchaser',''),
      project = nullif(h->>'project',''), ref_no = nullif(h->>'ref_no',''), description = nullif(h->>'description',''),
      price_mode = v_mode, warehouse_id = nullif(h->>'warehouse_id','')::uuid,
      show_signature = coalesce((h->>'show_signature')::boolean, true), note = nullif(h->>'note',''), internal_note = nullif(h->>'internal_note',''),
      discount_total = t_disc, exempt_base = t_ex, wht_total = t_wht
    where id = v_id;
  perform stock_in(g.product_id, g.warehouse_id, coalesce(g.stock_qty, g.qty), g.net, v_date, 'RI', v_id, v_no)
     from goods_receipt_lines g where g.ri_id = v_id order by g.line_no;
  return v_id;
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
    update goods_receipts set pv_voucher_id = null, wht_paid = 0 where id = p_id;
    update wht_certs set status = 'cancelled' where ri_id = p_id and status <> 'cancelled';
  elsif r.status = 'rejected' then
    update goods_receipts set uv_voucher_id = ri_post_uv(r) where id = p_id;
    perform stock_in(g.product_id, g.warehouse_id, coalesce(g.stock_qty, g.qty), g.net, r.ri_date, 'RI', p_id, r.ri_no)
       from goods_receipt_lines g where g.ri_id = p_id order by g.line_no;
  end if;
  update goods_receipts set status = 'unpaid' where id = p_id;
end $$;
create or replace function split_ri_from_po(p_po uuid, p_date date, p_mode text, p_value numeric, p_receive_stock boolean default false) returns uuid
language plpgsql as $$
declare po purchase_orders; l purchase_order_lines; v_id uuid := gen_random_uuid(); v_no text; v uuid; f numeric; target numeric;
        t_net numeric := 0; t_vat numeric := 0; n_net numeric; n_vat numeric; n int := 0; cnt int; v_lines jsonb; resid numeric;
        v_billed numeric; v_stock boolean; v_has_stock boolean;
begin
  select * into po from purchase_orders where id = p_po for update;
  if not found or po.status not in ('pending','approved','partial') then raise exception 'แบ่งจ่ายได้เฉพาะใบสั่งซื้อที่รออนุมัติ อนุมัติแล้ว หรือแบ่งจ่ายอยู่'; end if;
  if p_mode not in ('percent','amount') then raise exception 'โหมดแบ่งจ่าย % ไม่ถูกต้อง', p_mode; end if;
  if p_value is null or p_value <= 0 then raise exception 'ต้องระบุค่าแบ่งจ่ายมากกว่า 0'; end if;
  if po.total <= 0 then raise exception 'ใบสั่งซื้อไม่มียอด'; end if;
  target := case when p_mode = 'percent' then round(po.total * p_value / 100, 2) else p_value end;
  f := target / po.total;
  select count(*) into cnt from purchase_order_lines where po_id = p_po;
  v_no := next_doc_no('RI', p_date, true);
  insert into goods_receipts(id, ri_no, ri_date, contact_id) values (v_id, v_no, p_date, po.contact_id);
  for l in select * from purchase_order_lines where po_id = p_po order by line_no loop
    n := n + 1;
    n_net := round(l.net * f, 2); n_vat := round(l.vat * f, 2);
    if n = cnt then  -- เศษปัดตกบรรทัดสุดท้าย ให้ยอดรวมเท่ากับเป้าหมายพอดี
      resid := target - (t_net + t_vat + n_net + n_vat);
      n_net := n_net + resid;
    end if;
    insert into goods_receipt_lines(ri_id, line_no, product_id, warehouse_id, qty, unit_price, vat_rate, net, vat, description, unit, vat_exempt, stock_qty)
    values (v_id, n, l.product_id, coalesce(l.warehouse_id, po.warehouse_id, main_warehouse()), l.qty, l.unit_price, l.vat_rate, n_net, n_vat,
            l.description, l.unit, l.vat_exempt, l.stock_qty);
    t_net := t_net + n_net; t_vat := t_vat + n_vat;
  end loop;
  v_lines := jsonb_build_array(jsonb_build_object('account', sys_account('inventory'), 'debit', t_net));
  if t_vat > 0 then v_lines := v_lines || jsonb_build_object('account','17113','debit',t_vat); end if;
  v_lines := v_lines || jsonb_build_object('account','21311','credit', t_net + t_vat);
  v := post_voucher('UV', p_date, null, 'RI', v_id::text, v_lines);
  update goods_receipts set subtotal = t_net, vat = t_vat, total = t_net + t_vat, uv_voucher_id = v, po_id = p_po, ref_no = po.po_no,
      credit_days = po.credit_days, due_date = coalesce(po.due_date, p_date), purchaser = po.purchaser, project = po.project,
      description = po.description, price_mode = po.price_mode, warehouse_id = po.warehouse_id, note = po.note,
      split_mode = p_mode, split_value = p_value, stock_in_done = false
    where id = v_id;
  v_billed := po_billed(p_po);
  select exists(select 1 from goods_receipts where po_id = p_po and status <> 'cancelled' and stock_in_done) into v_has_stock;
  if p_receive_stock and v_has_stock then raise exception 'รับเข้าสต็อกไปแล้ว (รับได้ครั้งเดียว)'; end if;
  v_stock := not v_has_stock and (p_receive_stock or v_billed >= po.total);
  if v_stock then
    perform stock_in(l2.product_id, g.warehouse_id, coalesce(l2.stock_qty, l2.qty), l2.net, p_date, 'RI', v_id, v_no)
      from purchase_order_lines l2 join goods_receipt_lines g on g.ri_id = v_id and g.line_no = l2.line_no
      where l2.po_id = p_po order by l2.line_no;
    update goods_receipts set stock_in_done = true where id = v_id;
  end if;
  update purchase_orders set status = case when v_billed >= po.total then 'converted' else 'partial' end where id = p_po;
  return v_id;
end $$;
create or replace function split_ri_from_po_qty(p_po uuid, p_date date, p_qtys jsonb) returns uuid
language plpgsql as $$
declare po purchase_orders; l purchase_order_lines; q jsonb; v_id uuid := gen_random_uuid(); v_no text; v uuid;
        t_net numeric := 0; t_vat numeric := 0; n_net numeric; n_vat numeric; n int := 0; v_qty numeric; v_done numeric;
        v_lines jsonb; v_any boolean := false; v_sq numeric;
begin
  select * into po from purchase_orders where id = p_po for update;
  if not found or po.status not in ('approved','partial') then raise exception 'แบ่งจ่ายได้เฉพาะใบสั่งซื้อที่อนุมัติแล้ว'; end if;
  if exists (select 1 from goods_receipts where po_id = p_po and split_mode in ('percent','amount') and status not in ('cancelled','rejected')) then
    raise exception 'ใบสั่งซื้อนี้แบ่งจ่ายแบบ % / จำนวนเงินไปแล้ว แบ่งตามจำนวนสินค้าซ้ำไม่ได้', '%';
  end if;
  if jsonb_typeof(p_qtys) <> 'array' then raise exception 'รูปแบบจำนวนไม่ถูกต้อง'; end if;
  v_no := next_doc_no('RI', p_date, true);
  insert into goods_receipts(id, ri_no, ri_date, contact_id) values (v_id, v_no, p_date, po.contact_id);
  for l in select * from purchase_order_lines where po_id = p_po order by line_no loop
    select coalesce(sum((x->>'qty')::numeric), 0) into v_qty from jsonb_array_elements(p_qtys) x where (x->>'line_no')::int = l.line_no;
    if v_qty < 0 then raise exception 'จำนวนต้องไม่ติดลบ'; end if;
    if v_qty = 0 then continue; end if;
    v_done := po_line_billed_qty(p_po, l.line_no);
    if v_done + v_qty > l.qty then
      raise exception 'บรรทัดที่ % แบ่งเกินจำนวนคงเหลือ (เหลือ %)', l.line_no, l.qty - v_done;
    end if;
    if v_done + v_qty = l.qty then  -- ครบบรรทัด: รับส่วนที่เหลือทั้งหมด กันเศษปัด
      n_net := l.net - coalesce((select sum(g.net) from goods_receipt_lines g join goods_receipts r on r.id = g.ri_id
          where r.po_id = p_po and r.split_mode = 'qty' and r.status not in ('cancelled','rejected') and g.line_no = l.line_no), 0);
      n_vat := l.vat - coalesce((select sum(g.vat) from goods_receipt_lines g join goods_receipts r on r.id = g.ri_id
          where r.po_id = p_po and r.split_mode = 'qty' and r.status not in ('cancelled','rejected') and g.line_no = l.line_no), 0);
    else
      n_net := round(l.net * v_qty / l.qty, 2); n_vat := round(l.vat * v_qty / l.qty, 2);
    end if;
    if l.stock_qty is null then v_sq := null;
    elsif v_done + v_qty = l.qty then
      v_sq := l.stock_qty - coalesce((select sum(g.stock_qty) from goods_receipt_lines g join goods_receipts r on r.id = g.ri_id
          where r.po_id = p_po and r.split_mode = 'qty' and r.status not in ('cancelled','rejected') and g.line_no = l.line_no), 0);
    else v_sq := round(l.stock_qty * v_qty / l.qty, 4); end if;
    n := n + 1; v_any := true;
    insert into goods_receipt_lines(ri_id, line_no, product_id, warehouse_id, qty, unit_price, vat_rate, net, vat, description, unit, vat_exempt, stock_qty)
    values (v_id, l.line_no, l.product_id, coalesce(l.warehouse_id, po.warehouse_id, main_warehouse()), v_qty, l.unit_price, l.vat_rate, n_net, n_vat,
            l.description, l.unit, l.vat_exempt, v_sq);
    t_net := t_net + n_net; t_vat := t_vat + n_vat;
    perform stock_in(l.product_id, coalesce(l.warehouse_id, po.warehouse_id, main_warehouse()), coalesce(v_sq, v_qty), n_net, p_date, 'RI', v_id, v_no);
  end loop;
  if not v_any then raise exception 'ต้องระบุจำนวนที่แบ่งอย่างน้อย 1 บรรทัด'; end if;
  v_lines := jsonb_build_array(jsonb_build_object('account', sys_account('inventory'), 'debit', t_net));
  if t_vat > 0 then v_lines := v_lines || jsonb_build_object('account','17113','debit',t_vat); end if;
  v_lines := v_lines || jsonb_build_object('account','21311','credit', t_net + t_vat);
  v := post_voucher('UV', p_date, null, 'RI', v_id::text, v_lines);
  update goods_receipts set subtotal = t_net, vat = t_vat, total = t_net + t_vat, uv_voucher_id = v, po_id = p_po, ref_no = po.po_no,
      credit_days = po.credit_days, due_date = coalesce(po.due_date, p_date), purchaser = po.purchaser, project = po.project,
      description = po.description, price_mode = po.price_mode, warehouse_id = po.warehouse_id, note = po.note,
      split_mode = 'qty', split_value = null, stock_in_done = true
    where id = v_id;
  perform po_recompute_qty_status(p_po);
  return v_id;
end $$;
