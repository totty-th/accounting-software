create table fixed_asset_files (
  id         uuid primary key default gen_random_uuid(),
  asset_id   uuid not null references fixed_assets(id) on delete cascade,
  filename   text not null,
  mime       text not null,
  size       int  not null check (size > 0 and size <= 5242880),
  data       bytea not null,
  created_by uuid references app_users(id),
  created_at timestamptz not null default now()
);
create index on fixed_asset_files (asset_id);
create function add_asset_file(p_asset uuid, p_name text, p_mime text, p_data bytea) returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  if not exists (select 1 from fixed_assets where id = p_asset and status <> 'void') then raise exception 'ไม่พบสินทรัพย์'; end if;
  if (select count(*) from fixed_asset_files where asset_id = p_asset) >= 5 then raise exception 'แนบไฟล์ได้สูงสุด 5 ไฟล์ต่อสินทรัพย์'; end if;
  if length(p_data) = 0 then raise exception 'ไฟล์ว่างเปล่า'; end if;
  if length(p_data) > 5242880 then raise exception 'ไฟล์ใหญ่เกิน 5 MB'; end if;
  insert into fixed_asset_files(id, asset_id, filename, mime, size, data, created_by)
  values (v_id, p_asset, p_name, coalesce(nullif(p_mime, ''), 'application/octet-stream'), length(p_data), p_data, doc_event_actor());
  return v_id;
end $$;
create function remove_asset_file(p_file uuid) returns void language plpgsql as $$
begin
  delete from fixed_asset_files where id = p_file;
  if not found then raise exception 'ไม่พบไฟล์'; end if;
end $$;
