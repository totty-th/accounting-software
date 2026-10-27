alter table products add column category text, add column barcode text;
alter table warehouses add column postal_code text, add column low_stock_min numeric(18,4) check (low_stock_min is null or low_stock_min >= 0);
create table product_units (
  product_id uuid not null references products(id) on delete cascade,
  unit text not null, factor numeric(18,4) not null check (factor > 0),     -- 1 หน่วยนี้ = factor หน่วยหลัก
  sale_price numeric(18,2) not null default 0, purchase_price numeric(18,2) not null default 0, barcode text,
  primary key (product_id, unit)
);
create function set_opening_stock(p_product uuid, p_date date, p_qty numeric, p_cost numeric) returns void language plpgsql as $$
declare pr products;
begin
  select * into pr from products where id = p_product;
  if not found or pr.kind <> 'goods_stock' then raise exception 'ตั้งยอดตั้งต้นได้เฉพาะสินค้านับสต็อก'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'ยอดตั้งต้นต้องมากกว่า 0'; end if;
  if p_cost is null or p_cost < 0 then raise exception 'ต้องระบุต้นทุนต่อหน่วย'; end if;
  perform stock_in(p_product, main_warehouse(), p_qty, round(p_qty * p_cost, 2), p_date, 'OPEN', gen_random_uuid(), 'ยอดตั้งต้น');
end $$;
create table stock_adjustments (
  id uuid primary key default gen_random_uuid(), adj_no text not null unique, adj_date date not null,
  product_id uuid not null references products(id), warehouse_id uuid not null references warehouses(id),
  direction text not null check (direction in ('in','out')), reason text not null,
  qty numeric(18,4) not null check (qty > 0), unit_cost numeric(18,4), note text,
  status text not null default 'active' check (status in ('active','deleted')), created_at timestamptz not null default now()
);
create function adjust_stock(p_date date, p_product uuid, p_wh uuid, p_dir text, p_reason text, p_qty numeric,
                             p_cost numeric default null, p_note text default null) returns uuid language plpgsql as $$
declare pr products; v_id uuid := gen_random_uuid(); v_no text; v_cogs numeric; v_cost numeric;
begin
  select * into pr from products where id = p_product;
  if not found or pr.kind <> 'goods_stock' then raise exception 'ปรับยอดได้เฉพาะสินค้านับสต็อก'; end if;
  if p_dir not in ('in','out') then raise exception 'ทิศทางการปรับไม่ถูกต้อง'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'จำนวนปรับต้องมากกว่า 0'; end if;
  if p_wh is null then raise exception 'ต้องเลือกคลังสินค้า'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'ต้องระบุสาเหตุการปรับ'; end if;
  v_no := next_doc_no('ADJ', p_date, true);
  if p_dir = 'in' then
    v_cost := coalesce(p_cost, product_avg_cost(p_product));
    perform stock_in(p_product, p_wh, p_qty, round(p_qty * v_cost, 2), p_date, 'ADJ', v_id, v_no);
  else
    v_cogs := stock_out(p_product, p_wh, p_qty, p_date, 'ADJ', v_id, v_no);
    v_cost := round(v_cogs / p_qty, 4);
  end if;
  insert into stock_adjustments(id, adj_no, adj_date, product_id, warehouse_id, direction, reason, qty, unit_cost, note)
  values (v_id, v_no, p_date, p_product, p_wh, p_dir, p_reason, p_qty, v_cost, nullif(p_note, ''));
  return v_id;
end $$;
create function delete_stock_adjustment(p_id uuid) returns void language plpgsql as $$
declare a stock_adjustments; m stock_movements;
begin
  select * into a from stock_adjustments where id = p_id for update;
  if not found or a.status <> 'active' then raise exception 'ไม่พบรายการปรับยอดที่ใช้งานอยู่'; end if;
  perform stock_row(a.product_id);
  for m in select * from stock_movements where doc_id = p_id and voided_at is null loop
    update product_stock set qty = qty + m.qty_out - m.qty_in, value = value + (case when m.qty_out > 0 then m.value else -m.value end)
     where product_id = m.product_id;
    update stock_movements set voided_at = now() where id = m.id;
  end loop;
  update product_stock set last_avg = case when qty > 0 then round(value / qty, 4) else last_avg end where product_id = a.product_id;
  update stock_adjustments set status = 'deleted' where id = p_id;
end $$;
create function reset_transfer(p_id uuid) returns void language plpgsql as $$
begin
  update stock_transfers set status = 'pending' where id = p_id and status = 'received';
  if not found then raise exception 'รีเซ็ตได้เฉพาะใบโอนที่รับสินค้าแล้ว'; end if;
  update stock_movements set voided_at = now() where doc_id = p_id and doc_type = 'TF' and voided_at is null;
end $$;
create function update_warehouse(p_id uuid, p_name text, p_code text, p_purpose text, p_address text, p_postal text,
                                 p_contact text, p_email text, p_phone text) returns void language plpgsql as $$
begin
  update warehouses set name = p_name, code = p_code, purpose = p_purpose, address = nullif(p_address, ''), postal_code = nullif(p_postal, ''),
         contact_name = nullif(p_contact, ''), contact_email = nullif(p_email, ''), contact_phone = nullif(p_phone, '') where id = p_id;
  if not found then raise exception 'ไม่พบคลังสินค้า'; end if;
end $$;
create function set_main_warehouse(p_id uuid) returns void language plpgsql as $$
begin
  update warehouses set is_main = false where is_main;
  update warehouses set is_main = true where id = p_id;
  if not found then raise exception 'ไม่พบคลังสินค้า'; end if;
end $$;
create function low_stock_items(p_wh uuid default null)
returns table (product_id uuid, code text, name text, unit text, warehouse_id uuid, warehouse_name text, min_qty numeric, on_hand numeric)
language sql stable as $$
  select p.id, p.code, p.name, p.base_unit, w.id, w.name, w.low_stock_min, coalesce(sum(m.qty_in - m.qty_out), 0)
    from products p cross join warehouses w
    left join stock_movements m on m.product_id = p.id and m.warehouse_id = w.id and m.voided_at is null
   where p.kind = 'goods_stock' and p.is_active and w.low_stock_min is not null and (p_wh is null or w.id = p_wh)
   group by p.id, w.id
  having coalesce(sum(m.qty_in - m.qty_out), 0) <= w.low_stock_min
   order by p.code, w.name
$$;
