alter table products
  add column sale_vat_mode text not null default 'exclusive' check (sale_vat_mode in ('exclusive','inclusive','zero','exempt')),
  add column purchase_vat_mode text not null default 'exclusive' check (purchase_vat_mode in ('exclusive','inclusive','zero','exempt')),
  add column goods_type text not null default 'for_sale' check (goods_type in ('for_sale','other')),
  add column low_stock_mode text not null default 'default' check (low_stock_mode in ('default','custom')),
  add column import_batch uuid;
create table product_low_stock (
  product_id uuid not null references products(id) on delete cascade,
  warehouse_id uuid not null references warehouses(id) on delete cascade,
  min_qty numeric(18,4) not null check (min_qty >= 0),
  primary key (product_id, warehouse_id)
);
create or replace function low_stock_items(p_wh uuid default null)
returns table (product_id uuid, code text, name text, unit text, warehouse_id uuid, warehouse_name text, min_qty numeric, on_hand numeric)
language sql stable as $$
  select p.id, p.code, p.name, p.base_unit, w.id, w.name, t.thr, coalesce(sum(m.qty_in - m.qty_out), 0)
    from products p cross join warehouses w
    cross join lateral (select case when p.low_stock_mode = 'custom'
                                    then (select l.min_qty from product_low_stock l where l.product_id = p.id and l.warehouse_id = w.id)
                                    else w.low_stock_min end thr) t
    left join stock_movements m on m.product_id = p.id and m.warehouse_id = w.id and m.voided_at is null
   where p.kind = 'goods_stock' and p.is_active and t.thr is not null and (p_wh is null or w.id = p_wh)
     and coalesce((select low_stock_enabled from stock_settings), true)
   group by p.id, w.id, t.thr
  having coalesce(sum(m.qty_in - m.qty_out), 0) <= t.thr
   order by p.code, w.name
$$;
create function set_product_low_stock(p_id uuid, p_mode text, p_items jsonb default '[]') returns void language plpgsql as $$
declare i jsonb;
begin
  if p_mode not in ('default','custom') then raise exception 'โหมดสินค้าใกล้หมดไม่ถูกต้อง'; end if;
  update products set low_stock_mode = p_mode where id = p_id;
  if not found then raise exception 'ไม่พบสินค้า'; end if;
  delete from product_low_stock where product_id = p_id;
  if p_mode = 'custom' then
    for i in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
      insert into product_low_stock(product_id, warehouse_id, min_qty) values (p_id, (i->>'warehouse_id')::uuid, (i->>'min_qty')::numeric);
    end loop;
  end if;
end $$;
create or replace function update_product(p_id uuid, p jsonb) returns void language plpgsql as $$
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
         block_negative = coalesce((p->>'block_negative')::boolean, block_negative),
         description = case when p ? 'description' then nullif(p->>'description', '') else description end,
         sale_vat_mode = coalesce(p->>'sale_vat_mode', sale_vat_mode), purchase_vat_mode = coalesce(p->>'purchase_vat_mode', purchase_vat_mode),
         goods_type = coalesce(p->>'goods_type', goods_type)
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
create table product_import_batches (
  id uuid primary key default gen_random_uuid(), file_name text not null, warehouse_id uuid references warehouses(id),
  item_count int not null, created_at timestamptz not null default now(), deleted_at timestamptz
);
create function import_products(p_file text, p_wh uuid, p_items jsonb) returns uuid language plpgsql as $$
declare b uuid := gen_random_uuid(); it jsonb; u jsonb; pid uuid; v_wh uuid := coalesce(p_wh, main_warehouse()); n int := 0;
begin
  if jsonb_array_length(p_items) = 0 then raise exception 'ไม่มีรายการสินค้าให้นำเข้า'; end if;
  if jsonb_array_length(p_items) > 500 then raise exception 'นำเข้าได้ไม่เกิน 500 รายการต่อไฟล์'; end if;
  insert into product_import_batches(id, file_name, warehouse_id, item_count) values (b, coalesce(p_file, ''), v_wh, 0);
  for it in select * from jsonb_array_elements(p_items) loop
    insert into products(code, name, kind, base_unit, sale_price, purchase_price, category, barcode, description, sale_vat_mode, purchase_vat_mode, goods_type, import_batch)
    values (it->>'code', it->>'name', it->>'kind', coalesce(nullif(it->>'unit', ''), 'ชิ้น'), coalesce((it->>'sale')::numeric, 0), coalesce((it->>'buy')::numeric, 0),
            nullif(it->>'category', ''), nullif(it->>'barcode', ''), nullif(it->>'description', ''),
            coalesce(nullif(it->>'sale_vat', ''), 'exclusive'), coalesce(nullif(it->>'buy_vat', ''), 'exclusive'), coalesce(nullif(it->>'goods_type', ''), 'for_sale'), b)
    returning id into pid;
    for u in select * from jsonb_array_elements(coalesce(it->'units', '[]'::jsonb)) loop
      insert into product_units(product_id, unit, factor, sale_price, purchase_price, barcode)
      values (pid, u->>'unit', (u->>'factor')::numeric, coalesce((u->>'sale')::numeric, 0), coalesce((u->>'buy')::numeric, 0), nullif(u->>'barcode', ''));
    end loop;
    if it->'open' is not null and it->'open' <> 'null'::jsonb and (it->'open'->>'qty')::numeric > 0 then
      perform stock_in(pid, v_wh, (it->'open'->>'qty')::numeric, round((it->'open'->>'qty')::numeric * (it->'open'->>'cost')::numeric, 2),
                       (it->'open'->>'date')::date, 'OPEN', gen_random_uuid(), 'ยอดตั้งต้น');
    end if;
    n := n + 1;
  end loop;
  update product_import_batches set item_count = n where id = b;
  return b;
end $$;
create function delete_import_batch(p_id uuid) returns jsonb language plpgsql as $$
declare r record; d int := 0; k int := 0;
begin
  if not exists (select 1 from product_import_batches where id = p_id and deleted_at is null) then raise exception 'ไม่พบชุดนำเข้า หรือถูกลบไปแล้ว'; end if;
  for r in select id from products where import_batch = p_id loop
    begin
      if exists (select 1 from stock_movements where product_id = r.id and voided_at is null and doc_type <> 'OPEN') then k := k + 1; continue; end if;
      delete from stock_movements where product_id = r.id and doc_type = 'OPEN';
      delete from product_stock where product_id = r.id;
      delete from product_units where product_id = r.id;
      delete from products where id = r.id;
      d := d + 1;
    exception when foreign_key_violation then k := k + 1;
    end;
  end loop;
  update product_import_batches set deleted_at = now() where id = p_id;
  return jsonb_build_object('deleted', d, 'kept', k);
end $$;
