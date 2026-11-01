alter table contacts add column import_batch uuid;
create table contact_import_batches (
  id uuid primary key default gen_random_uuid(), file_name text not null,
  item_count int not null default 0, skipped_count int not null default 0,
  created_at timestamptz not null default now(), deleted_at timestamptz
);
create function import_contacts(p_file text, p_items jsonb) returns uuid language plpgsql as $$
declare b uuid := gen_random_uuid(); it jsonb; v_id uuid; n int := 0; s int := 0; v_kind text; v_branch text;
begin
  if jsonb_array_length(p_items) = 0 then raise exception 'ไม่มีรายชื่อให้นำเข้า'; end if;
  if jsonb_array_length(p_items) > 500 then raise exception 'นำเข้าได้ไม่เกิน 500 รายชื่อต่อไฟล์'; end if;
  insert into contact_import_batches(id, file_name) values (b, coalesce(p_file, ''));
  for it in select * from jsonb_array_elements(p_items) loop
    v_branch := nullif(btrim(it->>'branch_code'), '');
    if exists (select 1 from contacts where lower(btrim(business_name)) = lower(btrim(it->>'business_name'))
                 and coalesce(branch_code, '') = coalesce(v_branch, '')) then s := s + 1; continue; end if;
    v_kind := it->>'kinds';
    v_id := contact_save(null, it || jsonb_build_object('is_customer', v_kind in ('customer','both'), 'is_vendor', v_kind in ('vendor','both')));
    update contacts set import_batch = b where id = v_id;
    n := n + 1;
  end loop;
  update contact_import_batches set item_count = n, skipped_count = s where id = b;
  return b;
end $$;
create function delete_contact_import_batch(p_id uuid) returns jsonb language plpgsql as $$
declare r record; d int := 0; k int := 0;
begin
  if not exists (select 1 from contact_import_batches where id = p_id and deleted_at is null) then raise exception 'ไม่พบชุดนำเข้า หรือถูกลบไปแล้ว'; end if;
  for r in select id from contacts where import_batch = p_id loop
    begin delete from contacts where id = r.id; d := d + 1;
    exception when foreign_key_violation then k := k + 1; end;
  end loop;
  update contact_import_batches set deleted_at = now() where id = p_id;
  return jsonb_build_object('deleted', d, 'kept', k);
end $$;
