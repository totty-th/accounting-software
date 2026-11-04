create function save_doc_remarks(p jsonb) returns void language plpgsql as $$
declare k text;
begin
  if jsonb_typeof(p) <> 'object' then raise exception 'ข้อมูลหมายเหตุไม่ถูกต้อง'; end if;
  for k in select jsonb_object_keys(p) loop
    if k not in ('ALL','QT','BL','INV','RE','CA','CN','DN','PO','RI','PAY','EXP') then raise exception 'ชนิดเอกสารสำหรับหมายเหตุไม่ถูกต้อง: %', k; end if;
    if length(coalesce(p->>k, '')) > 1000 then raise exception 'หมายเหตุยาวเกิน 1000 ตัวอักษร'; end if;
  end loop;
  if p ? 'ALL' and (select count(*) from jsonb_object_keys(p)) > 1 then
    raise exception 'เลือกหมายเหตุ "เอกสารทั้งหมด" หรือแยกตามเอกสาร อย่างใดอย่างหนึ่ง';
  end if;
  update doc_settings set remarks = p, updated_at = now();
end $$;
