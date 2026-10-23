create table products (
  id             uuid primary key default gen_random_uuid(),
  code           text not null unique,
  name           text not null,
  kind           text not null check (kind in ('service','goods_nostock','goods_stock')),
  base_unit      text not null default 'ชิ้น',
  sale_price     numeric(18,2) not null default 0,
  purchase_price numeric(18,2) not null default 0,
  block_negative boolean not null default false,    -- D-03: true = ขายเกินคงเหลือไม่ได้
  is_active      boolean not null default true
);
create table warehouses (
  id        uuid primary key default gen_random_uuid(),
  code      text not null unique,
  name      text not null,
  purpose   text not null check (purpose in ('storage','raw_materials','branch','headquarters','consignment',
                                             'ecommerce','distribution_center','seasonal','other')),
  is_main   boolean not null default false,
  address   text, contact_name text, contact_phone text, contact_email text,
  created_at timestamptz not null default now()
);
create unique index warehouses_one_main on warehouses (is_main) where is_main;
insert into warehouses(code, name, purpose, is_main) values ('MAIN', 'คลังสินค้าหลัก', 'storage', true);
create function create_warehouse(p_code text, p_name text, p_purpose text) returns uuid language plpgsql as $$
declare v uuid;
begin
  if (select count(*) from warehouses where not is_main) >= 50 then
    raise exception 'เพิ่มคลังสินค้าได้ไม่เกิน 50 แห่ง (ไม่รวมคลังหลัก)';
  end if;
  insert into warehouses(code, name, purpose) values (p_code, p_name, p_purpose) returning id into v;
  return v;
end $$;
create function main_warehouse() returns uuid language sql stable as $$ select id from warehouses where is_main $$;
create table system_accounts (key text primary key, account_code text not null, note text);
insert into system_accounts values
  ('inventory', '11500', 'สินค้าคงเหลือ (ชั่วคราว ต้องยืนยันกับผังบัญชี)'),
  ('cogs',      '51100', 'ต้นทุนขาย (ชั่วคราว ต้องยืนยันกับผังบัญชี)');
create function sys_account(p_key text) returns text language plpgsql stable as $$
declare c text;
begin
  select account_code into c from system_accounts where key = p_key;
  if c is null or not exists (select 1 from accounts where code = c) then
    raise exception 'ยังไม่ได้ตั้งบัญชีระบบ % ในผังบัญชี', p_key;
  end if;
  return c;
end $$;
alter table sales_doc_lines add column product_id uuid references products(id);
alter table sales_doc_lines add column warehouse_id uuid references warehouses(id);
alter table sales_docs add column cogs_voucher_id uuid references journal_vouchers(id);
create function line_kind(l jsonb) returns text language plpgsql stable as $$
declare k text;
begin
  if nullif(l->>'product_id','') is not null then
    select kind into k from products where id = (l->>'product_id')::uuid;
    if k is null then raise exception 'ไม่พบสินค้า'; end if;
    return case when k = 'service' then 'service' else 'goods' end;
  end if;
  return coalesce(l->>'kind','service');
end $$;
create table product_stock (
  product_id uuid primary key references products(id),
  qty        numeric(18,4) not null default 0,
  value      numeric(18,2) not null default 0,
  last_avg   numeric(18,4) not null default 0     -- ต้นทุนเฉลี่ยล่าสุด ใช้ตอนคงเหลือ ≤ 0
);
create table stock_movements (
  id           uuid primary key default gen_random_uuid(),
  seq          bigserial,
  product_id   uuid not null references products(id),
  warehouse_id uuid not null references warehouses(id),
  move_date    date not null,
  doc_type     text not null,
  doc_id       uuid not null,
  doc_no       text,
  qty_in       numeric(18,4) not null default 0 check (qty_in >= 0),
  qty_out      numeric(18,4) not null default 0 check (qty_out >= 0),
  unit_cost    numeric(18,4),
  value        numeric(18,2) not null default 0,
  voided_at    timestamptz,
  created_at   timestamptz not null default now(),
  check ((qty_in > 0 and qty_out = 0) or (qty_out > 0 and qty_in = 0))
);
create index on stock_movements (product_id, warehouse_id) where voided_at is null;
create index on stock_movements (doc_id);
create table stock_alerts (
  id uuid primary key default gen_random_uuid(),
  doc_type text not null, doc_id uuid not null, product_id uuid not null references products(id),
  warehouse_id uuid not null references warehouses(id), shortfall numeric(18,4) not null,
  created_at timestamptz not null default now()
);
create function stock_on_hand(p_product uuid, p_wh uuid default null) returns numeric language sql stable as $$
  select coalesce(sum(qty_in - qty_out), 0) from stock_movements
   where product_id = p_product and voided_at is null and (p_wh is null or warehouse_id = p_wh);
$$;
create function product_avg_cost(p_product uuid) returns numeric language sql stable as $$
  select coalesce((select case when qty > 0 then round(value / qty, 4) else last_avg end
                     from product_stock where product_id = p_product),
                  (select purchase_price from products where id = p_product));
$$;
create function stock_row(p_product uuid) returns product_stock language plpgsql as $$
declare r product_stock;
begin
  insert into product_stock(product_id, last_avg)
  select id, purchase_price from products where id = p_product
  on conflict (product_id) do nothing;
  select * into r from product_stock where product_id = p_product for update;
  return r;
end $$;
create function stock_in(p_product uuid, p_wh uuid, p_qty numeric, p_value numeric, p_date date,
                         p_doc_type text, p_doc uuid, p_doc_no text) returns void language plpgsql as $$
declare r product_stock; nq numeric; nv numeric;
begin
  r := stock_row(p_product);
  nq := r.qty + p_qty; nv := r.value + p_value;
  update product_stock set qty = nq, value = nv,
         last_avg = case when nq > 0 then round(nv / nq, 4) else last_avg end
   where product_id = p_product;
  insert into stock_movements(product_id, warehouse_id, move_date, doc_type, doc_id, doc_no, qty_in, unit_cost, value)
  values (p_product, p_wh, p_date, p_doc_type, p_doc, p_doc_no, p_qty, round(p_value / p_qty, 4), p_value);
end $$;
create function stock_out(p_product uuid, p_wh uuid, p_qty numeric, p_date date,
                          p_doc_type text, p_doc uuid, p_doc_no text) returns numeric language plpgsql as $$
declare r product_stock; pr products; v_cost numeric; v_cogs numeric; v_after numeric;
begin
  select * into pr from products where id = p_product;
  r := stock_row(p_product);
  if pr.block_negative and stock_on_hand(p_product, p_wh) < p_qty then
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
create function stock_issue_for_doc(p_doc uuid) returns void language plpgsql as $$
declare d sales_docs; l record; v_cogs numeric := 0; v uuid;
begin
  select * into d from sales_docs where id = p_doc;
  for l in select sl.* from sales_doc_lines sl join products p on p.id = sl.product_id
            where sl.doc_id = p_doc and p.kind = 'goods_stock' order by sl.line_no loop
    v_cogs := v_cogs + stock_out(l.product_id, coalesce(l.warehouse_id, main_warehouse()), l.qty,
                                 d.doc_date, d.doc_type, d.id, d.doc_no);
  end loop;
  if v_cogs > 0 then
    v := post_voucher('SV', d.doc_date, 'ต้นทุนขาย ' || d.doc_no, d.doc_type || '-COGS', p_doc::text,
          jsonb_build_array(jsonb_build_object('account', sys_account('cogs'), 'debit', v_cogs),
                            jsonb_build_object('account', sys_account('inventory'), 'credit', v_cogs)));
    update sales_docs set cogs_voucher_id = v where id = p_doc;
  end if;
end $$;
create function stock_return_for_doc(p_doc uuid) returns void language plpgsql as $$
declare m stock_movements; d sales_docs;
begin
  select * into d from sales_docs where id = p_doc;
  for m in select * from stock_movements where doc_id = p_doc and voided_at is null and qty_out > 0 loop
    perform stock_row(m.product_id);
    update product_stock set qty = qty + m.qty_out, value = value + m.value,
           last_avg = case when qty + m.qty_out > 0 then round((value + m.value) / (qty + m.qty_out), 4) else last_avg end
     where product_id = m.product_id;
    update stock_movements set voided_at = now() where id = m.id;
  end loop;
  if d.cogs_voucher_id is not null then perform reverse_voucher(d.cogs_voucher_id); end if;
end $$;
create table goods_receipts (
  id uuid primary key default gen_random_uuid(),
  ri_no text not null unique, ri_date date not null, contact_id uuid not null references contacts(id),
  status text not null default 'unpaid' check (status in ('unpaid','paid','cancelled')),
  subtotal numeric(18,2) not null default 0, vat numeric(18,2) not null default 0, total numeric(18,2) not null default 0,
  uv_voucher_id uuid references journal_vouchers(id), pv_voucher_id uuid references journal_vouchers(id),
  created_at timestamptz not null default now()
);
create table goods_receipt_lines (
  ri_id uuid not null references goods_receipts(id), line_no int not null,
  product_id uuid not null references products(id), warehouse_id uuid not null references warehouses(id),
  qty numeric(18,4) not null check (qty > 0), unit_price numeric(18,2) not null check (unit_price >= 0),
  vat_rate numeric(5,2) not null default 7, net numeric(18,2) not null, vat numeric(18,2) not null,
  primary key (ri_id, line_no)
);
create function create_goods_receipt(p_date date, p_contact uuid, p_lines jsonb, p_price_mode text default 'exclusive')
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
    insert into goods_receipt_lines values (v_id, n, pr.id, wh, (l->>'qty')::numeric, (l->>'unit_price')::numeric, v_vr, v_net, v_vat);
    t_net := t_net + v_net; t_vat := t_vat + v_vat;
  end loop;
  v_lines := jsonb_build_array(jsonb_build_object('account', sys_account('inventory'), 'debit', t_net));
  if t_vat > 0 then v_lines := v_lines || jsonb_build_object('account','17113','debit',t_vat); end if;
  v_lines := v_lines || jsonb_build_object('account','21311','credit', t_net + t_vat);
  v := post_voucher('UV', p_date, null, 'RI', v_id::text, v_lines);
  update goods_receipts set subtotal = t_net, vat = t_vat, total = t_net + t_vat, uv_voucher_id = v where id = v_id;
  perform stock_in(g.product_id, g.warehouse_id, g.qty, g.net, p_date, 'RI', v_id, v_no)
     from goods_receipt_lines g where g.ri_id = v_id order by g.line_no;
  return v_id;
end $$;
create function pay_goods_receipt(p_id uuid, p_date date, p_pay_account text default '11112') returns uuid
language plpgsql as $$
declare r goods_receipts; v uuid;
begin
  select * into r from goods_receipts where id = p_id for update;
  if not found or r.status <> 'unpaid' then raise exception 'จ่ายเงินได้เฉพาะใบรับสินค้าที่ยังไม่จ่าย'; end if;
  v := post_voucher('PV', p_date, null, 'RI-PAY', p_id::text, jsonb_build_array(
        jsonb_build_object('account','21311','debit',r.total), jsonb_build_object('account',p_pay_account,'credit',r.total)));
  update goods_receipts set status = 'paid', pv_voucher_id = v where id = p_id;
  return v;
end $$;
create function cancel_goods_receipt(p_id uuid) returns void language plpgsql as $$
declare r goods_receipts; m stock_movements;
begin
  select * into r from goods_receipts where id = p_id for update;
  if not found or r.status = 'cancelled' then raise exception 'ไม่พบใบรับสินค้าหรือถูกยกเลิกแล้ว'; end if;
  for m in select * from stock_movements where doc_id = p_id and voided_at is null and qty_in > 0 loop
    if stock_on_hand(m.product_id, m.warehouse_id) - m.qty_in < 0
       or (select qty from product_stock where product_id = m.product_id) - m.qty_in < 0 then
      raise exception 'ยกเลิกไม่ได้: สต็อกที่รับเข้ามาถูกใช้ไปแล้ว';
    end if;
  end loop;
  for m in select * from stock_movements where doc_id = p_id and voided_at is null and qty_in > 0 loop
    update product_stock set qty = qty - m.qty_in, value = value - m.value,
           last_avg = case when qty - m.qty_in > 0 then round((value - m.value) / (qty - m.qty_in), 4) else last_avg end
     where product_id = m.product_id;
    update stock_movements set voided_at = now() where id = m.id;
  end loop;
  if r.pv_voucher_id is not null then perform reverse_voucher(r.pv_voucher_id); end if;
  perform reverse_voucher(r.uv_voucher_id);
  update goods_receipts set status = 'cancelled' where id = p_id;
end $$;
create table stock_transfers (
  id uuid primary key default gen_random_uuid(), tf_no text not null unique, tf_date date not null,
  from_wh uuid not null references warehouses(id), to_wh uuid not null references warehouses(id),
  status text not null default 'pending' check (status in ('pending','received','cancelled')),
  created_at timestamptz not null default now(), check (from_wh <> to_wh)
);
create table stock_transfer_lines (
  tf_id uuid not null references stock_transfers(id), line_no int not null,
  product_id uuid not null references products(id), qty numeric(18,4) not null check (qty > 0),
  unit_cost numeric(18,2) not null,     -- ราคาซื้อของสินค้า (ตามต้นแบบ) ใช้แสดงผลเท่านั้น
  primary key (tf_id, line_no)
);
create function create_transfer(p_date date, p_from uuid, p_to uuid, p_lines jsonb) returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid(); l jsonb; n int := 0; pr products;
begin
  insert into stock_transfers(id, tf_no, tf_date, from_wh, to_wh) values (v_id, next_doc_no('TF', p_date, true), p_date, p_from, p_to);
  for l in select * from jsonb_array_elements(p_lines) loop
    n := n + 1;
    select * into pr from products where id = (l->>'product_id')::uuid and kind = 'goods_stock';
    if not found then raise exception 'โอนได้เฉพาะสินค้านับสต็อก'; end if;
    insert into stock_transfer_lines values (v_id, n, pr.id, (l->>'qty')::numeric, pr.purchase_price);
  end loop;
  return v_id;
end $$;
create function receive_transfer(p_id uuid, p_date date default null) returns void language plpgsql as $$
declare t stock_transfers; l stock_transfer_lines; pr products; v_date date;
begin
  select * into t from stock_transfers where id = p_id for update;
  if not found or t.status <> 'pending' then raise exception 'รับสินค้าได้เฉพาะใบโอนที่รอดำเนินการ'; end if;
  v_date := coalesce(p_date, t.tf_date);
  for l in select * from stock_transfer_lines where tf_id = p_id order by line_no loop
    select * into pr from products where id = l.product_id;
    if pr.block_negative and stock_on_hand(l.product_id, t.from_wh) < l.qty then
      raise exception 'สต็อกต้นทางไม่พอ: %', pr.code;
    end if;
    insert into stock_movements(product_id, warehouse_id, move_date, doc_type, doc_id, doc_no, qty_out, unit_cost)
    values (l.product_id, t.from_wh, v_date, 'TF', p_id, t.tf_no, l.qty, l.unit_cost);
    insert into stock_movements(product_id, warehouse_id, move_date, doc_type, doc_id, doc_no, qty_in, unit_cost)
    values (l.product_id, t.to_wh, v_date, 'TF', p_id, t.tf_no, l.qty, l.unit_cost);
  end loop;
  update stock_transfers set status = 'received' where id = p_id;
end $$;
create function cancel_transfer(p_id uuid) returns void language plpgsql as $$
begin
  update stock_transfers set status = 'cancelled' where id = p_id and status = 'pending';
  if not found then raise exception 'ยกเลิกได้เฉพาะใบโอนที่รอดำเนินการ (ใบที่รับแล้วยังไม่ได้ทดสอบกับต้นแบบ)'; end if;
end $$;
