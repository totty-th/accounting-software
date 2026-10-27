create table stock_settings (
  singleton boolean primary key default true check (singleton),
  negative_sales text not null default 'warn' check (negative_sales in ('allow','warn','block')),  -- อนุญาต / แจ้งเตือนก่อนขาย / ไม่อนุญาต
  low_stock_enabled boolean not null default true
);
insert into stock_settings default values;
create or replace function stock_out(p_product uuid, p_wh uuid, p_qty numeric, p_date date,
                          p_doc_type text, p_doc uuid, p_doc_no text) returns numeric language plpgsql as $$
declare r product_stock; pr products; v_cost numeric; v_cogs numeric; v_after numeric; v_block boolean;
begin
  select * into pr from products where id = p_product;
  r := stock_row(p_product);
  v_block := pr.block_negative or (p_doc_type not in ('ADJ','TF') and coalesce((select negative_sales = 'block' from stock_settings), false));
  if v_block and stock_on_hand(p_product, p_wh) < p_qty then
    raise exception 'สต็อกไม่พอ: % คงเหลือ % ขาย %', pr.code, stock_on_hand(p_product, p_wh), p_qty;
  end if;
  v_cost := product_avg_cost(p_product);
  v_cogs := case when r.qty > 0 and p_qty = r.qty then r.value else round(p_qty * v_cost, 2) end;
  update product_stock set qty = qty - p_qty, value = value - v_cogs, last_avg = v_cost where product_id = p_product;
  insert into stock_movements(product_id, warehouse_id, move_date, doc_type, doc_id, doc_no, qty_out, unit_cost, value)
  values (p_product, p_wh, p_date, p_doc_type, p_doc, p_doc_no, p_qty, v_cost, v_cogs);
  v_after := stock_on_hand(p_product, p_wh);
  if v_after < 0 then
    insert into stock_alerts(doc_type, doc_id, product_id, warehouse_id, shortfall)
    values (p_doc_type, p_doc, p_product, p_wh, -v_after);
  end if;
  return v_cogs;
end $$;
create function set_stock_settings(p_negative text, p_low_enabled boolean) returns void language plpgsql as $$
begin
  if p_negative not in ('allow','warn','block') then raise exception 'ค่าขายติดลบไม่ถูกต้อง'; end if;
  update stock_settings set negative_sales = p_negative, low_stock_enabled = coalesce(p_low_enabled, low_stock_enabled);
end $$;
create or replace function low_stock_items(p_wh uuid default null)
returns table (product_id uuid, code text, name text, unit text, warehouse_id uuid, warehouse_name text, min_qty numeric, on_hand numeric)
language sql stable as $$
  select p.id, p.code, p.name, p.base_unit, w.id, w.name, w.low_stock_min, coalesce(sum(m.qty_in - m.qty_out), 0)
    from products p cross join warehouses w
    left join stock_movements m on m.product_id = p.id and m.warehouse_id = w.id and m.voided_at is null
   where p.kind = 'goods_stock' and p.is_active and w.low_stock_min is not null and (p_wh is null or w.id = p_wh)
     and coalesce((select low_stock_enabled from stock_settings), true)
   group by p.id, w.id
  having coalesce(sum(m.qty_in - m.qty_out), 0) <= w.low_stock_min
   order by p.code, w.name
$$;
create function update_product(p_id uuid, p jsonb) returns void language plpgsql as $$
declare pr products; u jsonb;
begin
  select * into pr from products where id = p_id;
  if not found then raise exception 'ไม่พบสินค้า'; end if;
  if coalesce(trim(p->>'name'), '') = '' then raise exception 'ต้องระบุชื่อสินค้า'; end if;
  if coalesce(p->>'kind', pr.kind) is distinct from pr.kind and exists (select 1 from stock_movements where product_id = p_id) then
    raise exception 'สินค้านี้มีความเคลื่อนไหวสต็อกแล้ว เปลี่ยนชนิดสินค้าไม่ได้'; end if;
  update products set name = p->>'name', code = coalesce(nullif(trim(p->>'code'), ''), code), kind = coalesce(p->>'kind', kind),
         category = nullif(p->>'category', ''), barcode = nullif(p->>'barcode', ''), base_unit = coalesce(nullif(p->>'base_unit', ''), base_unit),
         sale_price = coalesce((p->>'sale_price')::numeric, sale_price), purchase_price = coalesce((p->>'purchase_price')::numeric, purchase_price),
         block_negative = coalesce((p->>'block_negative')::boolean, block_negative)
   where id = p_id;
  if p ? 'units' then
    delete from product_units where product_id = p_id;
    for u in select * from jsonb_array_elements(p->'units') loop
      continue when coalesce(trim(u->>'unit'), '') = '';
      insert into product_units(product_id, unit, factor, sale_price, purchase_price, barcode)
      values (p_id, u->>'unit', (u->>'factor')::numeric, coalesce(nullif(u->>'sale_price','')::numeric, 0), coalesce(nullif(u->>'purchase_price','')::numeric, 0), nullif(u->>'barcode',''));
    end loop;
  end if;
end $$;
create function delete_product(p_id uuid) returns void language plpgsql as $$
begin
  delete from product_units where product_id = p_id;
  delete from product_stock where product_id = p_id;
  delete from products where id = p_id;
  if not found then raise exception 'ไม่พบสินค้า'; end if;
exception when foreign_key_violation then
  raise exception 'สินค้านี้ถูกใช้ในเอกสารหรือมีความเคลื่อนไหวสต็อกแล้ว ลบไม่ได้ — ใช้ "ปิดใช้งาน" แทน';
end $$;
create function set_product_active(p_id uuid, p_active boolean) returns void language plpgsql as $$
begin update products set is_active = p_active where id = p_id; if not found then raise exception 'ไม่พบสินค้า'; end if; end $$;
create function delete_warehouse(p_id uuid) returns void language plpgsql as $$
declare w warehouses;
begin
  select * into w from warehouses where id = p_id;
  if not found then raise exception 'ไม่พบคลังสินค้า'; end if;
  if w.is_main then raise exception 'ลบคลังหลักไม่ได้ — ตั้งคลังอื่นเป็นคลังหลักก่อน'; end if;
  if coalesce((select sum(qty_in - qty_out) from stock_movements where warehouse_id = p_id and voided_at is null), 0) <> 0 then
    raise exception 'คลังนี้ยังมีสินค้าคงเหลือ ลบไม่ได้'; end if;
  delete from warehouses where id = p_id;
exception when foreign_key_violation then
  raise exception 'คลังนี้มีประวัติการใช้งานแล้ว ลบไม่ได้';
end $$;
