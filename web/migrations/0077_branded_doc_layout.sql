alter table company_profile add column email text, add column signer_name text;
create or replace function save_doc_design(p_scope text, p jsonb) returns void language plpgsql as $$
begin
  if p->>'paper' is not null and p->>'paper' not in ('a4','continuous') then raise exception 'ขนาดกระดาษไม่ถูกต้อง'; end if;
  if p->>'paper_format' is not null and p->>'paper_format' not in ('standard','carbon','printshop') then raise exception 'รูปแบบกระดาษต่อเนื่องไม่ถูกต้อง'; end if;
  if p->>'layout' is not null and p->>'layout' not in ('standard','branded') then raise exception 'รูปแบบเอกสารไม่ถูกต้อง'; end if;
  if length(coalesce(p->>'form_code','')) > 40 then raise exception 'รหัสแบบฟอร์มยาวเกิน 40 ตัวอักษร'; end if;
  if p->>'font' is not null and p->>'font' not in ('plex','noto','sans') then raise exception 'ฟอนต์ไม่ถูกต้อง'; end if;
  if p->>'size' is not null and p->>'size' not in ('s','m','l') then raise exception 'ขนาดตัวอักษรไม่ถูกต้อง'; end if;
  if length(coalesce(p->>'title','')) > 80 then raise exception 'ชื่อหัวเอกสารยาวเกิน 80 ตัวอักษร'; end if;
  insert into doc_design(scope, settings) values (p_scope, p)
  on conflict (scope) do update set settings = excluded.settings, updated_at = now();
end $$;
