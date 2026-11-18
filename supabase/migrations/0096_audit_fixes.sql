-- M66 แก้บั๊กจากการตรวจประเมิน 18-11-2026 (รายงานตรวจประเมินระบบ ERP/บัญชี TMP หัวข้อ E)
-- B-03 ล็อกงวดครอบคลุมการเคลื่อนไหวสต็อกทุกชนิด (ปรับยอด ตั้งยอดตั้งต้น โอน ยกเลิก)
-- B-05 ห้ามมูลค่า/ต้นทุนติดลบ (B-06 ไม่แก้: ตั้งค่าระดับบริษัทไม่ครอบคลุมปรับยอดเป็นการตัดสินใจตาม FA ใน M26.2)
-- B-07 บันทึกย้อนหลัง → คำนวณต้นทุนถัวเฉลี่ยใหม่ตามวันที่เอกสาร (ไม่กระทบบัญชี เพราะสต็อกไม่ลง GL ตาม M12/M59)
-- B-12 ขายเป็นหน่วยรอง (มัด/กล่อง) ตัดสต็อกเป็นหน่วยหลัก · B-13 แก้/ลบการเคลื่อนไหวสต็อกตรง ๆ ไม่ได้
-- B-14 บันทึกผู้ล็อก/ผู้ปลดล็อกงวดและเหตุผล · B-04 เปิด RLS + ถอนสิทธิ์ anon/authenticated (แอปต่อด้วย postgres ซึ่ง bypass RLS)

-- ---------- B-05 ----------
create or replace function stock_in(p_product uuid, p_wh uuid, p_qty numeric, p_value numeric, p_date date,
                         p_doc_type text, p_doc uuid, p_doc_no text) returns void language plpgsql as $$
declare r product_stock; nq numeric; nv numeric;
begin
  if p_qty is null or p_qty <= 0 then raise exception 'จำนวนรับเข้าต้องมากกว่า 0'; end if;
  if p_value is null or p_value < 0 then raise exception 'มูลค่ารับเข้าต้องไม่ติดลบ'; end if;
  r := stock_row(p_product);
  nq := r.qty + p_qty; nv := r.value + p_value;
  update product_stock set qty = nq, value = nv,
         last_avg = case when nq > 0 then round(nv / nq, 4) else last_avg end
   where product_id = p_product;
  insert into stock_movements(product_id, warehouse_id, move_date, doc_type, doc_id, doc_no, qty_in, unit_cost, value)
  values (p_product, p_wh, p_date, p_doc_type, p_doc, p_doc_no, p_qty, round(p_value / p_qty, 4), p_value);
end $$;

create or replace function stock_out(p_product uuid, p_wh uuid, p_qty numeric, p_date date,
                          p_doc_type text, p_doc uuid, p_doc_no text) returns numeric language plpgsql as $$
declare r product_stock; pr products; v_cost numeric; v_cogs numeric; v_after numeric; v_block boolean;
begin
  select * into pr from products where id = p_product;
  r := stock_row(p_product);
  -- ตั้งค่าระดับบริษัทใช้กับเอกสารขายเท่านั้น ปรับยอด/โอนใช้กฎรายสินค้า (M26.2 ตาม FA) · B-06 รอเจ้าของระบบตัดสินใจ
  v_block := pr.block_negative or (p_doc_type not in ('ADJ','TF') and coalesce((select negative_sales = 'block' from stock_settings), false));
  if v_block and stock_on_hand(p_product, p_wh) < p_qty then
    raise exception 'สต็อกไม่พอ: % คงเหลือ % ต้องการ %', pr.code, stock_on_hand(p_product, p_wh), p_qty;
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
  return (select value from stock_movements where doc_id = p_doc and product_id = p_product and qty_out > 0 order by seq desc limit 1);
end $$;

-- ปรับยอด: ต้นทุนต้องไม่ติดลบ · จำว่าใส่ต้นทุนเองหรือใช้ต้นทุนเฉลี่ย (ใช้ตอนคำนวณใหม่ B-07)
alter table stock_adjustments add column cost_given boolean not null default true;
create or replace function adjust_stock(p_date date, p_product uuid, p_wh uuid, p_dir text, p_reason text, p_qty numeric,
                             p_cost numeric default null, p_note text default null) returns uuid language plpgsql as $$
declare pr products; v_id uuid := gen_random_uuid(); v_no text; v_cogs numeric; v_cost numeric;
begin
  select * into pr from products where id = p_product;
  if not found or pr.kind <> 'goods_stock' then raise exception 'ปรับยอดได้เฉพาะสินค้านับสต็อก'; end if;
  if p_dir not in ('in','out') then raise exception 'ทิศทางการปรับไม่ถูกต้อง'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'จำนวนปรับต้องมากกว่า 0'; end if;
  if p_cost is not null and p_cost < 0 then raise exception 'ต้นทุนต่อหน่วยต้องไม่ติดลบ'; end if;
  if p_wh is null then raise exception 'ต้องเลือกคลังสินค้า'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'ต้องระบุสาเหตุการปรับ'; end if;
  perform assert_period_open(p_date);
  v_no := next_doc_no('ADJ', p_date, true);
  -- บันทึกหัวเอกสารก่อน เพื่อให้การคำนวณต้นทุนใหม่ (ทริกเกอร์) รู้ว่าใส่ต้นทุนเองหรือไม่
  insert into stock_adjustments(id, adj_no, adj_date, product_id, warehouse_id, direction, reason, qty, unit_cost, note, cost_given)
  values (v_id, v_no, p_date, p_product, p_wh, p_dir, p_reason, p_qty, p_cost, nullif(p_note, ''), p_dir = 'in' and p_cost is not null);
  if p_dir = 'in' then
    v_cost := coalesce(p_cost, product_avg_cost(p_product));
    perform stock_in(p_product, p_wh, p_qty, round(p_qty * v_cost, 2), p_date, 'ADJ', v_id, v_no);
  else
    v_cogs := stock_out(p_product, p_wh, p_qty, p_date, 'ADJ', v_id, v_no);
    v_cost := round(v_cogs / p_qty, 4);
  end if;
  update stock_adjustments set unit_cost = (select unit_cost from stock_movements where doc_id = v_id and voided_at is null limit 1) where id = v_id;
  return v_id;
end $$;

-- ---------- B-07 คำนวณต้นทุนถัวเฉลี่ยใหม่ตามวันที่ ----------
-- ไล่การเคลื่อนไหวตามลำดับ (วันที่, ลำดับบันทึก) · ก่อนจุดเริ่ม ใช้ค่าที่บันทึกไว้ · ตั้งแต่จุดเริ่ม คำนวณใหม่:
--   จ่ายออก (ยกเว้นโอน) = ต้นทุนเฉลี่ย ณ ตอนนั้น · รับเข้าแบบไม่ระบุต้นทุน (ปรับยอดไม่ใส่ต้นทุน) = ต้นทุนเฉลี่ย ณ ตอนนั้น
--   รับเข้าที่มีต้นทุนจริง (ซื้อ ยอดตั้งต้น ปรับยอดใส่ต้นทุน รับคืน) และใบโอน คงค่าเดิม
-- รายการที่ต้นทุนเปลี่ยนต้องไม่อยู่ในงวดที่ล็อก
create function stock_recost(p_product uuid, p_from_date date, p_from_seq bigint) returns void language plpgsql as $$
declare m record; q numeric := 0; v numeric := 0; lst numeric; c numeric; nv numeric; nc numeric; redo boolean;
begin
  perform stock_row(p_product);
  select coalesce(purchase_price, 0) into lst from products where id = p_product;
  for m in select s.*, (s.doc_type = 'ADJ' and s.qty_in > 0 and exists (select 1 from stock_adjustments a where a.id = s.doc_id and not a.cost_given)) adj_avg
             from stock_movements s where s.product_id = p_product and s.voided_at is null order by s.move_date, s.seq loop
    redo := (m.move_date, m.seq) >= (p_from_date, p_from_seq) and m.doc_type <> 'TF';
    c := case when q > 0 then round(v / q, 4) else lst end;
    if m.qty_out > 0 then
      if redo then nc := c; nv := case when q > 0 and m.qty_out = q then v else round(m.qty_out * c, 2) end;
      else nc := m.unit_cost; nv := m.value; end if;
      q := q - m.qty_out; v := v - nv; lst := coalesce(nc, lst);
    else
      if redo and m.adj_avg then nc := c; nv := round(m.qty_in * c, 2);
      else nc := m.unit_cost; nv := m.value; end if;
      q := q + m.qty_in; v := v + nv;
      lst := case when q > 0 then round(v / q, 4) else lst end;
    end if;
    if nv is distinct from m.value or nc is distinct from m.unit_cost then
      perform assert_period_open(m.move_date);
      update stock_movements set unit_cost = nc, value = nv where id = m.id;
    end if;
  end loop;
  update product_stock set qty = q, value = v, last_avg = lst where product_id = p_product;
end $$;

-- ---------- B-03 / B-13 / B-07 ทริกเกอร์บนการเคลื่อนไหวสต็อก ----------
create function trg_stock_movement_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    perform assert_period_open(new.move_date);
    return new;
  elsif tg_op = 'UPDATE' then
    if (new.product_id, new.warehouse_id, new.move_date, new.doc_type, new.doc_id, new.doc_no, new.qty_in, new.qty_out, new.seq, new.created_at)
       is distinct from (old.product_id, old.warehouse_id, old.move_date, old.doc_type, old.doc_id, old.doc_no, old.qty_in, old.qty_out, old.seq, old.created_at) then
      raise exception 'แก้ไขการเคลื่อนไหวสต็อกไม่ได้ ให้ยกเลิกเอกสารต้นทางแทน';
    end if;
    if old.voided_at is not null and new.voided_at is null then raise exception 'คืนสถานะการเคลื่อนไหวสต็อกที่ยกเลิกแล้วไม่ได้'; end if;
    if old.voided_at is null and new.voided_at is not null then perform assert_period_open(old.move_date); end if;
    return new;
  else
    -- ลบได้กรณีเดียว: ยอดตั้งต้นของสินค้าที่ยังไม่เคยเคลื่อนไหว (ลบชุดนำเข้าสินค้า)
    if old.doc_type = 'OPEN' and not exists (select 1 from stock_movements where product_id = old.product_id and voided_at is null and doc_type <> 'OPEN') then
      return old;
    end if;
    raise exception 'ลบการเคลื่อนไหวสต็อกไม่ได้ ให้ยกเลิกเอกสารต้นทางแทน';
  end if;
end $$;
create trigger stock_movements_guard before insert or update or delete on stock_movements for each row execute function trg_stock_movement_guard();

create function trg_stock_movement_recost() returns trigger language plpgsql as $$
declare d date := case when tg_op = 'INSERT' then new.move_date else old.move_date end;
        s bigint := case when tg_op = 'INSERT' then new.seq else old.seq end;
begin
  -- มีการเคลื่อนไหวที่ลงวันที่หลังกว่า = บันทึก/ยกเลิกย้อนหลัง → คำนวณต้นทุนใหม่ตั้งแต่จุดนั้น
  if exists (select 1 from stock_movements where product_id = new.product_id and voided_at is null and id <> new.id
               and doc_type <> 'TF' and (move_date, seq) > (d, s) and move_date > d) then
    perform stock_recost(new.product_id, d, s);
  end if;
  return null;
end $$;
create trigger stock_movements_recost_ins after insert on stock_movements for each row execute function trg_stock_movement_recost();
create trigger stock_movements_recost_void after update of voided_at on stock_movements for each row
  when (old.voided_at is null and new.voided_at is not null) execute function trg_stock_movement_recost();

-- ตั้งยอดตั้งต้นในงวดที่ล็อกไม่ได้ (ทริกเกอร์กันอยู่แล้ว · เช็กก่อนเพื่อข้อความชัด)
create or replace function set_opening_stock(p_product uuid, p_date date, p_qty numeric, p_cost numeric) returns void language plpgsql as $$
declare pr products;
begin
  select * into pr from products where id = p_product;
  if not found or pr.kind <> 'goods_stock' then raise exception 'ตั้งยอดตั้งต้นได้เฉพาะสินค้านับสต็อก'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'ยอดตั้งต้นต้องมากกว่า 0'; end if;
  if p_cost is null or p_cost < 0 then raise exception 'ต้องระบุต้นทุนต่อหน่วย'; end if;
  perform assert_period_open(p_date);
  perform stock_in(p_product, main_warehouse(), p_qty, round(p_qty * p_cost, 2), p_date, 'OPEN', gen_random_uuid(), 'ยอดตั้งต้น');
end $$;

-- ---------- B-12 ขายเป็นหน่วยรอง ----------
create function line_base_qty(p_product uuid, p_unit text, p_qty numeric) returns numeric language sql stable as $$
  select p_qty * coalesce((select u.factor from product_units u join products p on p.id = u.product_id
                            where u.product_id = p_product and lower(btrim(u.unit)) = lower(btrim(coalesce(p_unit, '')))
                              and lower(btrim(u.unit)) <> lower(btrim(coalesce(p.base_unit, '')))), 1)
$$;
create or replace function stock_issue_for_doc(p_doc uuid) returns void language plpgsql as $$
declare d sales_docs; l record; v_cogs numeric;
begin
  select * into d from sales_docs where id = p_doc;
  for l in select sl.* from sales_doc_lines sl join products p on p.id = sl.product_id
            where sl.doc_id = p_doc and p.kind = 'goods_stock' order by sl.line_no loop
    v_cogs := stock_out(l.product_id, coalesce(l.warehouse_id, main_warehouse()), line_base_qty(l.product_id, l.unit, l.qty),
                        d.doc_date, d.doc_type, d.id, d.doc_no);
  end loop;
end $$;

-- ---------- B-14 ประวัติล็อก/ปลดล็อกงวด ----------
alter table period_locks add column created_by uuid, add column released_by uuid, add column release_reason text;
create or replace function lock_period(p_from date, p_to date, p_reason text) returns uuid language plpgsql as $$
declare v_id uuid;
begin
  if p_to > today_th() - 1 then raise exception 'ล็อกงวดได้ถึงเมื่อวานเท่านั้น'; end if;
  insert into period_locks(date_from, date_to, reason, created_by) values (p_from, p_to, p_reason, doc_event_actor()) returning id into v_id;
  return v_id;
end $$;
drop function release_period_lock(uuid);
create function release_period_lock(p_id uuid, p_reason text default null) returns void language plpgsql as $$
begin
  update period_locks set released_at = now(), released_by = doc_event_actor(), release_reason = nullif(btrim(coalesce(p_reason, '')), '')
   where id = p_id and released_at is null;
  if not found then raise exception 'ไม่พบการล็อกงวดที่ใช้งานอยู่'; end if;
end $$;

-- ---------- B-04 ปิดทาง Data API (Supabase) ----------
-- แอปต่อฐานข้อมูลด้วย postgres (bypass RLS) · เปิด RLS ไม่ใส่ policy = anon/authenticated อ่านเขียนไม่ได้
do $$
declare t record; f record;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' loop
    execute format('alter table public.%I enable row level security', t.relname);
  end loop;
  -- ฟังก์ชันทุกตัวกำหนด search_path (Advisor function_search_path_mutable)
  for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prokind = 'f' and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e') loop
    execute format('alter function %s set search_path = public, pg_temp', f.sig);
  end loop;
  if exists (select 1 from pg_roles where rolname = 'anon') and exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on all tables in schema public from anon, authenticated';
    execute 'revoke all on all sequences in schema public from anon, authenticated';
    execute 'revoke execute on all functions in schema public from anon, authenticated, public';
    execute 'alter default privileges in schema public revoke all on tables from anon, authenticated';
    execute 'alter default privileges in schema public revoke all on sequences from anon, authenticated';
    execute 'alter default privileges in schema public revoke execute on functions from anon, authenticated, public';
  end if;
end $$;
