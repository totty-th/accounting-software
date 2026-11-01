-- M29 จัดการสินทรัพย์ถาวร (REA FA 1-11-2026, docs/rea-assets.md)
-- สูตร (ตามที่ทดสอบบน FA): อัตรา/ปี = ปัดทศนิยม 2 ตำแหน่งของ 100/อายุ · ค่าเสื่อม/ปี = (ราคา − ซาก) × อัตราที่ปัดแล้ว
--   ค่าเสื่อมสะสมถึงวันที่ X = ค่าเสื่อม/ปี × จำนวนวัน ÷ 365 (นับวันเริ่มคำนวณและวันเลิกใช้ครบทั้งสองวัน) · ค่าเสื่อมงวด = ส่วนต่างของยอดสะสม
-- ลงบัญชีรายเดือน (JV วันสิ้นเดือน) · เมื่อข้อมูลสินทรัพย์เปลี่ยน: เจ้าของระบบเลือก "กลับรายการ -R แล้วลงใหม่" (FA แก้ใบเดิมทับ — เราไม่ทำ)
-- ไม่ได้ทดสอบบน FA (ทำแบบง่าย รอเจ้าของระบบตัดสินใจ): บริจาค/ทำลาย · ลบสินทรัพย์ · ย้อนสถานะ "ขาย" · พักการใช้งานกระทบค่าเสื่อมหรือไม่ · บัญชีพัก 49990 ตอนขาย

create table asset_categories (
  id            uuid primary key default gen_random_uuid(),
  name          text not null unique,
  name_en       text,
  depreciate    boolean not null default true,
  life_years    numeric(6,2) check (life_years is null or life_years > 0),
  asset_account text not null,      -- บัญชีสินทรัพย์ (12xxx)
  dep_account   text,               -- ค่าเสื่อมราคา (586xx)
  accum_account text,               -- ค่าเสื่อมราคาสะสม (186xx)
  sort_no       int not null default 0,
  is_active     boolean not null default true,
  check (not depreciate or (life_years is not null and dep_account is not null and accum_account is not null))
);
-- หมวดเริ่มต้น 6 หมวดตามต้นแบบ · อายุใช้งานเริ่มต้นที่เห็นจริงมีเฉพาะไอที (3 ปี) หมวดอื่นตั้งไว้ก่อน เจ้าของแก้ได้ที่หน้าตั้งค่า
insert into asset_categories(name, name_en, depreciate, life_years, asset_account, dep_account, accum_account, sort_no) values
  ('คอมพิวเตอร์/อุปกรณ์ไอที', 'Computer / IT equipment', true, 3, '12612', '58612', '18612', 1),
  ('เฟอร์นิเจอร์/อุปกรณ์สำนักงาน', 'Office furniture / equipment', true, 5, '12611', '58611', '18611', 2),
  ('ซื้อของไว้ใช้ในธุรกิจ', 'Business supplies', true, 5, '12611', '58611', '18611', 3),
  ('เฟอร์นิเจอร์และตกแต่งสำนักงาน', 'Furniture and office fixtures', true, 5, '12613', '58613', '18613', 4),
  ('ยานพาหนะ', 'Vehicles', true, 5, '12614', '58614', '18614', 5),
  ('ซอฟต์แวร์คอมพิวเตอร์', 'Computer software', true, 3, '12710', '58711', '18711', 6);

create table asset_settings (
  id boolean primary key default true check (id),
  disposal_clearing_account text not null default '49990',   -- ตามต้นแบบ: เดบิตราคาขายไว้ที่ 49990 (รอตัดสินใจ)
  disposal_gain_loss_account text not null default '49880'
);
insert into asset_settings default values;

create table fixed_assets (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,
  name          text not null,
  description   text,
  ref_no        text,
  category_id   uuid not null references asset_categories(id),
  qty           numeric(18,4) not null default 1 check (qty > 0),
  unit          text,
  purchase_date date not null,
  start_date    date not null,                 -- วันที่เริ่มต้นใช้งาน
  cost          numeric(18,2) not null check (cost >= 0),
  depreciate    boolean not null default true,
  salvage       numeric(18,2) not null default 1.00 check (salvage >= 0),
  life_years    numeric(6,2) check (life_years is null or life_years > 0),
  accum_open    numeric(18,2) not null default 0 check (accum_open >= 0),
  calc_start    date not null,                 -- วันเริ่มคำนวณค่าเสื่อม (>= start_date)
  vendor        text,
  serial_no     text,
  warranty_end  date,
  location      text,
  user_name     text,
  note          text,
  status        text not null default 'in_use' check (status in ('in_use','suspended','sold','disposed','void')),
  disposed_date date,
  dispose_type  text check (dispose_type in ('sold','donated','destroyed')),
  sale_price    numeric(18,2),
  dispose_note  text,
  disposal_voucher_id uuid references journal_vouchers(id),
  expense_id    uuid references expenses(id),
  expense_line  int,
  created_at    timestamptz not null default now(),
  check (calc_start >= start_date),
  check (not depreciate or life_years is not null),
  unique (expense_id, expense_line)
);
create index fixed_assets_status_idx on fixed_assets(status, category_id);

alter table expense_lines add column asset_category_id uuid references asset_categories(id);

create function ensure_account(p_code text, p_name text) returns void language sql as $$
  insert into accounts(code, name, type) values (p_code, p_name, account_type_of(p_code)) on conflict (code) do nothing
$$;

-- ชื่อบัญชีตั้งต้นของรหัสที่หมวดเริ่มต้นใช้ (สร้างตอนใช้งานครั้งแรก ไม่ชนกับผังที่มีอยู่)
create function asset_account_name(p_code text) returns text language sql immutable as $$
  select coalesce((select n from (values
    ('12611','เฟอร์นิเจอร์และอุปกรณ์สำนักงาน'), ('12612','คอมพิวเตอร์และอุปกรณ์'), ('12613','เฟอร์นิเจอร์และตกแต่งสำนักงาน'),
    ('12614','ยานพาหนะ'), ('12710','ซอฟต์แวร์คอมพิวเตอร์'),
    ('58611','ค่าเสื่อมราคา - เฟอร์นิเจอร์และอุปกรณ์สำนักงาน'), ('58612','ค่าเสื่อมราคา - คอมพิวเตอร์และอุปกรณ์'),
    ('58613','ค่าเสื่อมราคา - เฟอร์นิเจอร์และตกแต่งสำนักงาน'), ('58614','ค่าเสื่อมราคา - ยานพาหนะ'), ('58711','ค่าตัดจำหน่าย - ซอฟต์แวร์คอมพิวเตอร์'),
    ('18611','ค่าเสื่อมราคาสะสม - เฟอร์นิเจอร์และอุปกรณ์สำนักงาน'), ('18612','ค่าเสื่อมราคาสะสม - คอมพิวเตอร์และอุปกรณ์'),
    ('18613','ค่าเสื่อมราคาสะสม - เฟอร์นิเจอร์และตกแต่งสำนักงาน'), ('18614','ค่าเสื่อมราคาสะสม - ยานพาหนะ'), ('18711','ค่าตัดจำหน่ายสะสม - ซอฟต์แวร์คอมพิวเตอร์'),
    ('49880','กำไร(ขาดทุน)จากการจำหน่ายสินทรัพย์'), ('49990','รายได้อื่น')) t(c, n) where c = p_code), 'บัญชี ' || p_code)
$$;
create function asset_ensure_cat_accounts(c asset_categories) returns void language plpgsql as $$
begin
  perform ensure_account(c.asset_account, asset_account_name(c.asset_account));
  if c.dep_account is not null then perform ensure_account(c.dep_account, asset_account_name(c.dep_account)); end if;
  if c.accum_account is not null then perform ensure_account(c.accum_account, asset_account_name(c.accum_account)); end if;
end $$;

-- ---------- สูตรค่าเสื่อม ----------
create function asset_rate(p_life numeric) returns numeric language sql immutable as $$
  select case when p_life is null or p_life <= 0 then 0 else round(100 / p_life, 2) end
$$;
create function asset_annual(a fixed_assets) returns numeric language sql immutable as $$
  select round(greatest(a.cost - a.salvage, 0) * asset_rate(a.life_years) / 100, 2)
$$;
-- ค่าเสื่อมสะสม "เฉพาะที่คำนวณหลังวันเริ่มคำนวณ" ถึงวันที่ p_upto (ไม่รวมยกมา) · ไม่เกินมูลค่าที่คิดค่าเสื่อมคงเหลือ
create function asset_dep_cum(a fixed_assets, p_upto date) returns numeric language plpgsql immutable as $$
declare u date; v_base numeric;
begin
  if not a.depreciate or a.status = 'void' or p_upto is null then return 0; end if;
  u := least(p_upto, coalesce(a.disposed_date, p_upto));
  if u < a.calc_start then return 0; end if;
  v_base := greatest(a.cost - a.salvage - a.accum_open, 0);
  return least(v_base, round(asset_annual(a) * (u - a.calc_start + 1) / 365, 2));
end $$;
create function asset_dep_period(a fixed_assets, p_from date, p_to date) returns numeric language sql immutable as $$
  select asset_dep_cum(a, p_to) - asset_dep_cum(a, p_from - 1)
$$;
-- ค่าเสื่อมสะสมรวมยกมา ณ วันที่
create function asset_accum_at(a fixed_assets, p_date date) returns numeric language sql immutable as $$
  select case when a.depreciate and a.status <> 'void' then a.accum_open + asset_dep_cum(a, p_date) else 0 end
$$;
-- จำนวนวันที่คิดค่าเสื่อมในช่วง
create function asset_dep_days(a fixed_assets, p_from date, p_to date) returns int language sql immutable as $$
  select case when not a.depreciate or a.status = 'void' then 0
    else greatest(0, least(p_to, coalesce(a.disposed_date, p_to)) - greatest(p_from, a.calc_start) + 1) end
$$;

-- ---------- ลงบัญชีค่าเสื่อมรายเดือน ----------
create function asset_dep_month_lines(p_ym date) returns table(dep text, accum text, amt numeric) language sql stable as $$
  select c.dep_account, c.accum_account, sum(asset_dep_period(a, date_trunc('month', p_ym)::date, (date_trunc('month', p_ym) + interval '1 month - 1 day')::date))
  from fixed_assets a join asset_categories c on c.id = a.category_id
  where a.status <> 'void' and a.depreciate
  group by c.dep_account, c.accum_account
  having sum(asset_dep_period(a, date_trunc('month', p_ym)::date, (date_trunc('month', p_ym) + interval '1 month - 1 day')::date)) > 0
$$;

-- ใบสำคัญค่าเสื่อมที่ใช้งานอยู่ของเดือน (ยังไม่ถูกกลับรายการ)
create function asset_dep_voucher(p_ym date) returns journal_vouchers language sql stable as $$
  select v.* from journal_vouchers v
  where v.source_type = 'DEP' and v.source_id = to_char(p_ym, 'YYYY-MM') and v.reverses_id is null
    and not exists (select 1 from journal_vouchers r where r.reverses_id = v.id)
  limit 1
$$;

-- ลงบัญชีเดือนเดียว: ถ้ายอดเท่าเดิมไม่ทำอะไร · ถ้าเปลี่ยน กลับรายการ -R ใบเดิมแล้วลงใหม่ · เดือนที่ยอดเป็นศูนย์ไม่มีใบ
create function post_asset_dep_month(p_ym date) returns uuid language plpgsql as $$
declare v_from date := date_trunc('month', p_ym)::date; v_to date := (date_trunc('month', p_ym) + interval '1 month - 1 day')::date;
        o journal_vouchers; r asset_categories; v_cur jsonb; v_want jsonb;
begin
  o := asset_dep_voucher(v_from);
  -- ยอดที่ต้องการ เรียงตามบัญชี
  select coalesce(jsonb_agg(jsonb_build_object('account', code, 'debit', d, 'credit', c) order by code), '[]'::jsonb) into v_want from (
    select code, sum(d) d, sum(c) c from (
      select dep code, amt d, 0::numeric c from asset_dep_month_lines(v_from)
      union all select accum, 0, amt from asset_dep_month_lines(v_from)) x group by code) y;
  if o.id is not null then
    select coalesce(jsonb_agg(jsonb_build_object('account', code, 'debit', d, 'credit', c) order by code), '[]'::jsonb) into v_cur from (
      select a.code, sum(l.debit) d, sum(l.credit) c from journal_lines l join accounts a on a.id = l.account_id where l.voucher_id = o.id group by a.code) y;
    if v_cur = v_want then return o.id; end if;
    perform reverse_voucher(o.id, o.voucher_date);
  elsif jsonb_array_length(v_want) = 0 then return null;
  end if;
  if jsonb_array_length(v_want) = 0 then return null; end if;
  for r in select c.* from asset_categories c where exists (select 1 from asset_dep_month_lines(v_from) m where m.dep = c.dep_account) loop
    perform asset_ensure_cat_accounts(r);
  end loop;
  return post_voucher('JV', v_to, 'บันทึกรายการค่าเสื่อมสำหรับงวด ' || to_char(v_from, 'MM-YYYY'), 'DEP', to_char(v_from, 'YYYY-MM'), v_want);
end $$;

-- ลงทั้งปี (ทุกเดือน ม.ค.–ธ.ค. ตามต้นแบบ แม้เดือนยังไม่ถึง) · คืนจำนวนเดือนที่มีใบสำคัญใหม่
create function post_asset_depreciation(p_year int) returns int language plpgsql as $$
declare m int; v_before uuid; v_after uuid; n int := 0;
begin
  if p_year < 2000 or p_year > 2200 then raise exception 'ปีไม่ถูกต้อง'; end if;
  for m in 1..12 loop
    v_before := (asset_dep_voucher(make_date(p_year, m, 1))).id;
    v_after := post_asset_dep_month(make_date(p_year, m, 1));
    if v_after is distinct from v_before then n := n + 1; end if;
  end loop;
  return n;
end $$;

-- ข้อมูลสินทรัพย์เปลี่ยน → ปรับทุกเดือนที่เคยลงบัญชีไว้ (กลับรายการ -R แล้วลงใหม่เฉพาะเดือนที่ยอดเปลี่ยน)
create function asset_resync_dep() returns void language plpgsql as $$
declare s text;
begin
  for s in select distinct source_id from journal_vouchers where source_type = 'DEP' and reverses_id is null order by source_id loop
    perform post_asset_dep_month((s || '-01')::date);
  end loop;
end $$;

-- ตารางแผนรายเดือนของปี: ยอดที่ควรเป็น เทียบกับที่ลงบัญชีไว้
create function asset_dep_plan(p_year int) returns table(ym date, expected numeric, posted numeric, voucher_id uuid, voucher_no text, voucher_date date)
language sql stable as $$
  select m.ym,
         coalesce((select sum(amt) from asset_dep_month_lines(m.ym)), 0),
         coalesce((select sum(l.debit) from journal_lines l where l.voucher_id = (asset_dep_voucher(m.ym)).id), 0),
         (asset_dep_voucher(m.ym)).id, (asset_dep_voucher(m.ym)).voucher_no, (asset_dep_voucher(m.ym)).voucher_date
  from (select make_date(p_year, g, 1) ym from generate_series(1, 12) g) m order by m.ym
$$;

-- ---------- เพิ่ม / แก้ / สถานะ ----------
create function asset_validate(a fixed_assets) returns void language plpgsql as $$
begin
  if coalesce(btrim(a.name), '') = '' then raise exception 'ต้องระบุชื่อสินทรัพย์'; end if;
  if a.cost is null or a.cost < 0 then raise exception 'ราคาซื้อต้องไม่ติดลบ'; end if;
  if a.depreciate then
    if a.life_years is null or a.life_years <= 0 then raise exception 'ต้องระบุอายุการใช้งาน (ปี)'; end if;
    if a.salvage > a.cost then raise exception 'มูลค่าซากต้องไม่เกินราคาซื้อ'; end if;
    if a.accum_open > greatest(a.cost - a.salvage, 0) then raise exception 'ค่าเสื่อมสะสมยกมาต้องไม่เกินมูลค่าที่คิดค่าเสื่อม'; end if;
  end if;
  if a.calc_start < a.start_date then raise exception 'วันเริ่มคำนวณค่าเสื่อมต้องไม่ก่อนวันที่เริ่มต้นใช้งาน'; end if;
end $$;

create function create_asset(p_data jsonb) returns uuid language plpgsql as $$
declare d jsonb := coalesce(p_data, '{}'); c asset_categories; a fixed_assets; v_start date; v_acc numeric;
begin
  select * into c from asset_categories where id = nullif(d->>'category_id', '')::uuid and is_active;
  if not found then raise exception 'ต้องเลือกหมวดหมู่สินทรัพย์'; end if;
  if nullif(d->>'purchase_date', '') is null then raise exception 'ต้องระบุวันที่ซื้อ'; end if;
  v_start := coalesce(nullif(d->>'start_date', '')::date, (d->>'purchase_date')::date);
  v_acc := coalesce(nullif(d->>'accum_open', '')::numeric, 0);
  a.id := gen_random_uuid(); a.name := btrim(coalesce(d->>'name', ''));
  a.code := coalesce(nullif(btrim(d->>'code'), ''), next_doc_no('AS', current_date, false));
  a.description := nullif(d->>'description', ''); a.ref_no := nullif(d->>'ref_no', ''); a.category_id := c.id;
  a.qty := coalesce(nullif(d->>'qty', '')::numeric, 1); a.unit := nullif(d->>'unit', '');
  a.purchase_date := (d->>'purchase_date')::date; a.start_date := v_start;
  a.cost := coalesce(nullif(d->>'cost', '')::numeric, 0);
  a.depreciate := coalesce((d->>'depreciate')::boolean, c.depreciate);
  a.salvage := coalesce(nullif(d->>'salvage', '')::numeric, 1.00);
  a.life_years := coalesce(nullif(d->>'life_years', '')::numeric, c.life_years);
  a.accum_open := v_acc;
  a.calc_start := coalesce(nullif(d->>'calc_start', '')::date, v_start);
  a.vendor := nullif(d->>'vendor', ''); a.serial_no := nullif(d->>'serial_no', ''); a.warranty_end := nullif(d->>'warranty_end', '')::date;
  a.location := nullif(d->>'location', ''); a.user_name := nullif(d->>'user_name', ''); a.note := nullif(d->>'note', '');
  a.status := 'in_use';
  perform asset_validate(a);
  insert into fixed_assets(id, code, name, description, ref_no, category_id, qty, unit, purchase_date, start_date, cost, depreciate, salvage, life_years,
      accum_open, calc_start, vendor, serial_no, warranty_end, location, user_name, note, status)
  values (a.id, a.code, a.name, a.description, a.ref_no, a.category_id, a.qty, a.unit, a.purchase_date, a.start_date, a.cost, a.depreciate, a.salvage,
      a.life_years, a.accum_open, a.calc_start, a.vendor, a.serial_no, a.warranty_end, a.location, a.user_name, a.note, 'in_use');
  perform asset_resync_dep();
  return a.id;
end $$;

-- แก้ไข: สินทรัพย์ที่มาจากค่าใช้จ่ายแก้ชื่อ/จำนวน/วันที่ซื้อ/ราคา/ผู้จำหน่าย/เลขที่อ้างอิงไม่ได้ (ผูกกับเอกสารต้นทาง)
create function update_asset(p_id uuid, p_data jsonb) returns void language plpgsql as $$
declare d jsonb := coalesce(p_data, '{}'); a fixed_assets; n fixed_assets; v_lock boolean;
begin
  select * into a from fixed_assets where id = p_id for update;
  if not found or a.status = 'void' then raise exception 'ไม่พบสินทรัพย์'; end if;
  if a.status in ('sold','disposed') then raise exception 'สินทรัพย์ที่เลิกใช้งานแล้วแก้ไขไม่ได้'; end if;
  v_lock := a.expense_id is not null;
  n := a;
  if nullif(d->>'category_id', '') is not null then
    if not exists (select 1 from asset_categories where id = (d->>'category_id')::uuid) then raise exception 'ไม่พบหมวดหมู่สินทรัพย์'; end if;
    n.category_id := (d->>'category_id')::uuid;
  end if;
  if not v_lock then
    n.name := btrim(coalesce(d->>'name', a.name)); n.qty := coalesce(nullif(d->>'qty', '')::numeric, a.qty);
    n.purchase_date := coalesce(nullif(d->>'purchase_date', '')::date, a.purchase_date);
    n.cost := coalesce(nullif(d->>'cost', '')::numeric, a.cost);
    n.vendor := nullif(d->>'vendor', ''); n.ref_no := nullif(d->>'ref_no', '');
  end if;
  n.code := coalesce(nullif(btrim(d->>'code'), ''), a.code);
  n.description := nullif(d->>'description', ''); n.unit := case when v_lock then a.unit else nullif(d->>'unit', '') end;
  n.start_date := coalesce(nullif(d->>'start_date', '')::date, a.start_date);
  n.depreciate := coalesce((d->>'depreciate')::boolean, a.depreciate);
  n.salvage := coalesce(nullif(d->>'salvage', '')::numeric, a.salvage);
  n.life_years := coalesce(nullif(d->>'life_years', '')::numeric, a.life_years);
  n.accum_open := coalesce(nullif(d->>'accum_open', '')::numeric, 0);
  n.calc_start := coalesce(nullif(d->>'calc_start', '')::date, n.start_date);
  n.serial_no := nullif(d->>'serial_no', ''); n.warranty_end := nullif(d->>'warranty_end', '')::date;
  n.location := nullif(d->>'location', ''); n.user_name := nullif(d->>'user_name', ''); n.note := nullif(d->>'note', '');
  perform asset_validate(n);
  update fixed_assets set code = n.code, name = n.name, description = n.description, ref_no = n.ref_no, category_id = n.category_id, qty = n.qty,
      unit = n.unit, purchase_date = n.purchase_date, start_date = n.start_date, cost = n.cost, depreciate = n.depreciate, salvage = n.salvage,
      life_years = n.life_years, accum_open = n.accum_open, calc_start = n.calc_start, vendor = n.vendor, serial_no = n.serial_no,
      warranty_end = n.warranty_end, location = n.location, user_name = n.user_name, note = n.note
  where id = p_id;
  perform asset_resync_dep();
end $$;

-- พักการใช้งาน ⇄ ใช้งานอยู่ (ทันที ไม่ลงบัญชี · ผลต่อค่าเสื่อมของสถานะพักการใช้งาน: ยังไม่ทดสอบ จึงคิดค่าเสื่อมต่อ)
create function set_asset_status(p_id uuid, p_status text) returns void language plpgsql as $$
declare a fixed_assets;
begin
  if p_status not in ('in_use', 'suspended') then raise exception 'เปลี่ยนสถานะได้เฉพาะ ใช้งานอยู่ / พักการใช้งาน (การขายหรือเลิกใช้ต้องกรอกข้อมูลเลิกใช้งาน)'; end if;
  select * into a from fixed_assets where id = p_id for update;
  if not found or a.status in ('void', 'sold', 'disposed') then raise exception 'เปลี่ยนสถานะสินทรัพย์นี้ไม่ได้'; end if;
  update fixed_assets set status = p_status where id = p_id;
end $$;

-- ตัดสินทรัพย์ออก (ขาย / บริจาค / ทำลาย)
-- รายการบัญชีตามที่ FA ทำตอนขาย: Dr ค่าเสื่อมสะสม · Dr บัญชีพักราคาขาย (49990) · Dr/Cr กำไรขาดทุนจากการจำหน่าย (49880) · Cr สินทรัพย์
-- บริจาค/ทำลาย (ยังไม่ทดสอบ): ไม่มีราคาขาย → Dr ค่าเสื่อมสะสม · Dr 49880 (มูลค่าคงเหลือ) · Cr สินทรัพย์
create function dispose_asset(p_id uuid, p_date date, p_type text, p_price numeric default 0, p_note text default null) returns uuid language plpgsql as $$
declare a fixed_assets; c asset_categories; s asset_settings; v_accum numeric; v_book numeric; v_diff numeric; v_price numeric; v_lines jsonb := '[]'::jsonb; v uuid;
begin
  if p_type not in ('sold', 'donated', 'destroyed') then raise exception 'ประเภทการเลิกใช้ไม่ถูกต้อง'; end if;
  select * into a from fixed_assets where id = p_id for update;
  if not found or a.status not in ('in_use', 'suspended') then raise exception 'สินทรัพย์นี้เลิกใช้งานไม่ได้ (ต้องเป็นสถานะใช้งานอยู่หรือพักการใช้งาน)'; end if;
  if p_date is null then raise exception 'ต้องระบุวันที่เลิกใช้'; end if;
  if p_date < a.calc_start and a.depreciate then raise exception 'วันที่เลิกใช้ต้องไม่ก่อนวันเริ่มคำนวณค่าเสื่อม'; end if;
  if p_date < a.start_date then raise exception 'วันที่เลิกใช้ต้องไม่ก่อนวันที่เริ่มใช้งาน'; end if;
  v_price := case when p_type = 'sold' then coalesce(p_price, 0) else 0 end;
  if v_price < 0 then raise exception 'มูลค่าที่ขายต้องไม่ติดลบ'; end if;
  select * into c from asset_categories where id = a.category_id;
  select * into s from asset_settings;
  update fixed_assets set disposed_date = p_date, dispose_type = p_type, sale_price = nullif(v_price, 0), dispose_note = nullif(btrim(p_note), ''),
      status = case when p_type = 'sold' then 'sold' else 'disposed' end where id = p_id;
  select * into a from fixed_assets where id = p_id;
  v_accum := asset_accum_at(a, p_date); v_book := a.cost - v_accum; v_diff := v_book - v_price;
  if a.cost > 0 then
    perform asset_ensure_cat_accounts(c);
    perform ensure_account(s.disposal_gain_loss_account, asset_account_name(s.disposal_gain_loss_account));
    perform ensure_account(s.disposal_clearing_account, asset_account_name(s.disposal_clearing_account));
    if v_accum > 0 then v_lines := v_lines || jsonb_build_object('account', c.accum_account, 'debit', v_accum); end if;
    if v_price > 0 then v_lines := v_lines || jsonb_build_object('account', s.disposal_clearing_account, 'debit', v_price); end if;
    if v_diff > 0 then v_lines := v_lines || jsonb_build_object('account', s.disposal_gain_loss_account, 'debit', v_diff);
    elsif v_diff < 0 then v_lines := v_lines || jsonb_build_object('account', s.disposal_gain_loss_account, 'credit', -v_diff); end if;
    v_lines := v_lines || jsonb_build_object('account', c.asset_account, 'credit', a.cost);
    v := post_voucher('JV', p_date, case p_type when 'sold' then 'ขายสินทรัพย์ ' when 'donated' then 'บริจาคสินทรัพย์ ' else 'ทำลายสินทรัพย์ ' end || a.code || ' ' || a.name,
                      'ASSET_DISP', p_id::text, v_lines);
    update fixed_assets set disposal_voucher_id = v where id = p_id;
  end if;
  perform asset_resync_dep();
  return v;
end $$;

-- ย้อนสถานะเลิกใช้งาน (ยังไม่ทดสอบบน FA): กลับรายการใบตัดสินทรัพย์ -R แล้วคืนเป็นใช้งานอยู่
create function reopen_asset(p_id uuid) returns void language plpgsql as $$
declare a fixed_assets;
begin
  select * into a from fixed_assets where id = p_id for update;
  if not found or a.status not in ('sold', 'disposed') then raise exception 'สินทรัพย์นี้ไม่ได้อยู่ในสถานะเลิกใช้งาน'; end if;
  if a.disposal_voucher_id is not null then perform reverse_voucher(a.disposal_voucher_id); end if;
  update fixed_assets set status = 'in_use', disposed_date = null, dispose_type = null, sale_price = null, dispose_note = null, disposal_voucher_id = null where id = p_id;
  perform asset_resync_dep();
end $$;

-- ลบสินทรัพย์ (ยังไม่ทดสอบบน FA): ลบได้เฉพาะสินทรัพย์ยกมาที่ยังใช้งาน/พักอยู่ ไม่ได้มาจากเอกสารค่าใช้จ่าย
create function delete_asset(p_id uuid) returns void language plpgsql as $$
declare a fixed_assets;
begin
  select * into a from fixed_assets where id = p_id for update;
  if not found then raise exception 'ไม่พบสินทรัพย์'; end if;
  if a.expense_id is not null then raise exception 'สินทรัพย์นี้สร้างจากเอกสารค่าใช้จ่าย ลบไม่ได้ (ยกเลิกเอกสารค่าใช้จ่ายแทน)'; end if;
  if a.status not in ('in_use', 'suspended') then raise exception 'สินทรัพย์ที่เลิกใช้งานแล้วลบไม่ได้ (ย้อนสถานะก่อน)'; end if;
  delete from fixed_assets where id = p_id;
  perform asset_resync_dep();
end $$;

-- ---------- หมวดหมู่ ----------
create function save_asset_category(p_id uuid, p_data jsonb) returns uuid language plpgsql as $$
declare d jsonb := coalesce(p_data, '{}'); c asset_categories; v_id uuid := coalesce(p_id, gen_random_uuid());
begin
  c.name := btrim(coalesce(d->>'name', '')); c.name_en := nullif(btrim(d->>'name_en'), '');
  c.depreciate := coalesce((d->>'depreciate')::boolean, true);
  c.life_years := nullif(d->>'life_years', '')::numeric;
  c.asset_account := btrim(coalesce(d->>'asset_account', ''));
  c.dep_account := nullif(btrim(d->>'dep_account'), ''); c.accum_account := nullif(btrim(d->>'accum_account'), '');
  if c.name = '' then raise exception 'ต้องระบุชื่อหมวดหมู่'; end if;
  if c.asset_account = '' or c.asset_account !~ '^1[0-9]{4}$' then raise exception 'ต้องเลือกบัญชีสินทรัพย์ (รหัส 1xxxx)'; end if;
  if c.depreciate then
    if c.life_years is null or c.life_years <= 0 then raise exception 'ต้องระบุอายุการใช้งาน (ปี)'; end if;
    if c.dep_account is null or c.accum_account is null then raise exception 'ต้องเลือกบัญชีค่าเสื่อมราคาและค่าเสื่อมราคาสะสม'; end if;
  end if;
  if p_id is null then
    insert into asset_categories(id, name, name_en, depreciate, life_years, asset_account, dep_account, accum_account, sort_no)
    values (v_id, c.name, c.name_en, c.depreciate, c.life_years, c.asset_account, c.dep_account, c.accum_account, (select coalesce(max(sort_no), 0) + 1 from asset_categories));
  else
    -- แก้บัญชีของหมวดที่มีสินทรัพย์ที่ลงค่าเสื่อมแล้ว → ตารางจะคำนวณใหม่ตามหมวดและกลับรายการ -R ให้เอง
    update asset_categories set name = c.name, name_en = c.name_en, depreciate = c.depreciate, life_years = c.life_years,
        asset_account = c.asset_account, dep_account = c.dep_account, accum_account = c.accum_account where id = p_id;
    if not found then raise exception 'ไม่พบหมวดหมู่'; end if;
  end if;
  select * into c from asset_categories where id = v_id;
  perform asset_ensure_cat_accounts(c);
  if p_id is not null then perform asset_resync_dep(); end if;
  return v_id;
end $$;

-- ---------- เชื่อมกับค่าใช้จ่าย ----------
-- บรรทัดค่าใช้จ่ายที่เลือกหมวดสินทรัพย์ (asset_category) → ลงบัญชีสินทรัพย์ของหมวดนั้น และสร้างสินทรัพย์ให้ทันที (ราคา = ก่อน VAT)
create or replace function save_expense(p_header jsonb, p_lines jsonb) returns uuid language plpgsql as $$
declare h jsonb := coalesce(p_header, '{}'); l jsonb; n int := 0; c record; v_id uuid := gen_random_uuid(); v uuid;
        v_date date := (h->>'date')::date; v_mode text := coalesce(nullif(h->>'price_mode',''), 'exclusive');
        v_cd int := coalesce(nullif(h->>'credit_days','')::int, 0); v_dt text; v_dv numeric; v_wr numeric; v_wht numeric;
        t_net numeric := 0; t_vat numeric := 0; t_disc numeric := 0; t_ex numeric := 0; t_wht numeric := 0; v_lines jsonb := '[]'::jsonb;
        v_no text; v_acct text; v_cat asset_categories; v_vendor text;
begin
  if p_lines is null or jsonb_array_length(p_lines) = 0 then raise exception 'ต้องมีรายการอย่างน้อย 1 บรรทัด'; end if;
  if v_mode not in ('exclusive','inclusive') then raise exception 'ราคาสินค้า % ไม่ถูกต้อง', v_mode; end if;
  if v_date is null then raise exception 'ต้องระบุวันที่'; end if;
  if nullif(h->>'contact','') is null then raise exception 'ต้องเลือกผู้จำหน่าย'; end if;
  v_no := next_doc_no('EXP', v_date, true);
  select business_name into v_vendor from contacts where id = (h->>'contact')::uuid;
  insert into expenses(id, exp_no, exp_date, contact_id, price_mode) values (v_id, v_no, v_date, (h->>'contact')::uuid, v_mode);
  for l in select * from jsonb_array_elements(p_lines) loop
    n := n + 1;
    v_cat := null; v_acct := l->>'account';
    if nullif(l->>'asset_category','') is not null then
      select * into v_cat from asset_categories where id = (l->>'asset_category')::uuid and is_active;
      if not found then raise exception 'บรรทัด % ไม่พบหมวดหมู่สินทรัพย์', n; end if;
      perform asset_ensure_cat_accounts(v_cat);
      v_acct := v_cat.asset_account;
    end if;
    if nullif(v_acct,'') is null then raise exception 'บรรทัด % ต้องเลือกหมวดค่าใช้จ่าย', n; end if;
    if coalesce(nullif(l->>'description',''), '') = '' then raise exception 'บรรทัด % ต้องระบุรายละเอียด', n; end if;
    v_dt := coalesce(nullif(l->>'discount_type',''), 'percent'); v_dv := coalesce(nullif(l->>'discount_value','')::numeric, 0);
    v_wr := coalesce(nullif(l->>'wht_rate','')::numeric, 0);
    select * into c from purchase_line_calc((l->>'qty')::numeric, (l->>'unit_price')::numeric, v_dt, v_dv, coalesce(l->>'vat','7'), v_mode);
    v_wht := round(c.v_net * v_wr / 100, 2);
    insert into expense_lines(expense_id, line_no, description, category, account_code, qty, unit_price, vat_rate, wht_rate, net, vat, wht,
        unit, discount_type, discount_value, discount, vat_exempt, asset_category_id)
    values (v_id, n, l->>'description', nullif(l->>'category',''), v_acct, (l->>'qty')::numeric, (l->>'unit_price')::numeric,
        c.v_rate, v_wr, c.v_net, c.v_vat, v_wht, nullif(l->>'unit',''), v_dt, v_dv, c.v_disc, c.v_exempt, v_cat.id);
    t_net := t_net + c.v_net; t_vat := t_vat + c.v_vat; t_disc := t_disc + c.v_disc; t_wht := t_wht + v_wht;
    if c.v_exempt then t_ex := t_ex + c.v_net; end if;
    v_lines := v_lines || jsonb_build_object('account', v_acct, 'debit', c.v_net);
    if v_cat.id is not null then
      insert into fixed_assets(code, name, ref_no, category_id, qty, unit, purchase_date, start_date, cost, depreciate, salvage, life_years,
          calc_start, vendor, expense_id, expense_line)
      values (next_doc_no('AS', v_date, false), l->>'description', v_no, v_cat.id, (l->>'qty')::numeric, nullif(l->>'unit',''), v_date, v_date, c.v_net,
          v_cat.depreciate, case when c.v_net >= 1 then 1.00 else 0 end, v_cat.life_years, v_date, v_vendor, v_id, n);
    end if;
  end loop;
  if t_vat > 0 then v_lines := v_lines || jsonb_build_object('account','17113','debit',t_vat); end if;
  v_lines := v_lines || jsonb_build_object('account','21399','credit', t_net + t_vat);
  v := post_voucher('UV', v_date, null, 'EXP', v_id::text, v_lines);
  update expenses set subtotal = t_net, vat = t_vat, total = t_net + t_vat, wht_total = t_wht, uv_voucher_id = v,
      credit_days = v_cd, due_date = coalesce(nullif(h->>'due_date','')::date, v_date + v_cd), purchaser = nullif(h->>'purchaser',''),
      project = nullif(h->>'project',''), ref_no = nullif(h->>'ref_no',''), description = nullif(h->>'description',''),
      show_signature = coalesce((h->>'show_signature')::boolean, true), note = nullif(h->>'note',''), internal_note = nullif(h->>'internal_note',''),
      discount_total = t_disc, exempt_base = t_ex
    where id = v_id;
  return v_id;
end $$;

-- ยกเลิก/ไม่อนุมัติค่าใช้จ่าย → สินทรัพย์ที่สร้างจากเอกสารนั้นเป็น "ยกเลิก" (ไม่แสดง ไม่คิดค่าเสื่อม) · รีเซ็ตจากไม่อนุมัติ → กลับมาใช้งาน
-- (เป็นแนวทางของเราเอง: ต้นแบบยังไม่ได้ทดสอบกรณียกเลิกเอกสารที่สร้างสินทรัพย์) · ถ้าสินทรัพย์ถูกเลิกใช้ไปแล้ว ห้ามยกเลิกเอกสาร
create function asset_follow_expense() returns trigger language plpgsql as $$
begin
  if new.status in ('cancelled', 'rejected') and old.status not in ('cancelled', 'rejected') then
    if exists (select 1 from fixed_assets where expense_id = new.id and status in ('sold', 'disposed')) then
      raise exception 'มีสินทรัพย์จากเอกสารนี้ที่เลิกใช้งานแล้ว ยกเลิกเอกสารไม่ได้ (ย้อนสถานะสินทรัพย์ก่อน)';
    end if;
    update fixed_assets set status = 'void' where expense_id = new.id and status <> 'void';
    if found then perform asset_resync_dep(); end if;
  elsif old.status = 'rejected' and new.status = 'pending' then
    update fixed_assets set status = 'in_use' where expense_id = new.id and status = 'void';
    if found then perform asset_resync_dep(); end if;
  end if;
  return new;
end $$;
create trigger expenses_asset_follow after update of status on expenses for each row execute function asset_follow_expense();
