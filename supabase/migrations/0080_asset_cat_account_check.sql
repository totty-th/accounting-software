-- ตรวจบัญชีของหมวดสินทรัพย์ตอนบันทึก: ห้ามบัญชีคุม · ค่าเสื่อม=5xxxx · ค่าเสื่อมสะสม=1xxxx (พบจากการทดลองโรงงานตะแกรง 7-11-2026 tests/m50)

create or replace function save_asset_category(p_id uuid, p_data jsonb) returns uuid language plpgsql as $$
declare d jsonb := coalesce(p_data, '{}'); c asset_categories; v_id uuid := coalesce(p_id, gen_random_uuid()); v_chk text;
begin
  c.name := btrim(coalesce(d->>'name', '')); c.name_en := nullif(btrim(d->>'name_en'), '');
  c.depreciate := coalesce((d->>'depreciate')::boolean, true);
  c.life_years := nullif(d->>'life_years', '')::numeric;
  c.asset_account := btrim(coalesce(d->>'asset_account', ''));
  c.dep_account := nullif(btrim(d->>'dep_account'), ''); c.accum_account := nullif(btrim(d->>'accum_account'), '');
  if c.name = '' then raise exception 'ต้องระบุชื่อหมวดหมู่'; end if;
  if c.asset_account = '' or c.asset_account !~ '^1[0-9]{4}$' then raise exception 'ต้องเลือกบัญชีสินทรัพย์ (รหัส 1xxxx)'; end if;
  -- บัญชีที่ใช้ต้องลงรายการได้: ห้ามเป็นบัญชีคุม (หัวกลุ่มของผังมาตรฐาน เช่น 12616/18616/58616) — ไม่งั้นไปพังตอนลงบัญชีค่าเสื่อม/ซื้อสินทรัพย์
  for v_chk in select x from unnest(array[c.asset_account, c.dep_account, c.accum_account]) x where x is not null loop
    if exists (select 1 from accounts where code = v_chk and is_control) then
      raise exception 'บัญชี % เป็นบัญชีคุม (หัวกลุ่ม) ลงรายการไม่ได้ — สร้างบัญชีย่อยใต้กลุ่มนี้ที่หน้าผังบัญชีก่อน แล้วเลือกรหัสบัญชีย่อยนั้น', v_chk;
    end if;
  end loop;
  if c.dep_account is not null and c.dep_account !~ '^5[0-9]{4}$' then raise exception 'บัญชีค่าเสื่อมราคาต้องเป็นบัญชีค่าใช้จ่าย (รหัส 5xxxx)'; end if;
  if c.accum_account is not null and c.accum_account !~ '^1[0-9]{4}$' then raise exception 'บัญชีค่าเสื่อมราคาสะสมต้องเป็นบัญชีสินทรัพย์ (รหัส 1xxxx)'; end if;
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
