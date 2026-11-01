-- ตั้งค่ารูปแบบดีไซน์เอกสาร (REA FA 02-11-2026): โหมดเรียบง่าย (scope 'all') / ขั้นสูง (ทับรายชนิดเอกสาร QT/INV/CA/BL/CN/DN)
-- ยังไม่ทดสอบบนต้นแบบ: กระดาษต่อเนื่องจริง (ขนาด/ขอบ), ฟอนต์ CS ChatThai/RSU (เป็นฟอนต์ของต้นแบบ ใช้ Noto Sans Thai/IBM Plex แทน), เทมเพลต "ตารางและรูป"
alter table company_profile add column logo_img text;
create table doc_design (scope text primary key check (scope in ('all','QT','INV','CA','BL','CN','DN')), settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now());
create function save_doc_design(p_scope text, p jsonb) returns void language plpgsql as $$
begin
  if p->>'paper' is not null and p->>'paper' not in ('a4','continuous') then raise exception 'ขนาดกระดาษไม่ถูกต้อง'; end if;
  if p->>'font' is not null and p->>'font' not in ('plex','noto','sans') then raise exception 'ฟอนต์ไม่ถูกต้อง'; end if;
  if p->>'size' is not null and p->>'size' not in ('s','m','l') then raise exception 'ขนาดตัวอักษรไม่ถูกต้อง'; end if;
  if length(coalesce(p->>'title','')) > 80 then raise exception 'ชื่อหัวเอกสารยาวเกิน 80 ตัวอักษร'; end if;
  insert into doc_design(scope, settings) values (p_scope, p)
  on conflict (scope) do update set settings = excluded.settings, updated_at = now();
end $$;
create function reset_doc_design() returns void language sql as $$ delete from doc_design $$;
