-- ตั้ง 'คลังหลัก' เป็นค่าเริ่มต้นในหน้าเอกสาร (ตาม FA): ปิด = ผู้ใช้ต้องเลือกคลังเองทุกครั้งตอนสร้างเอกสาร
alter table doc_settings add column default_main_warehouse boolean not null default true;

create or replace function save_doc_settings(p jsonb) returns void language plpgsql as $$
declare k text;
begin
  for k in select jsonb_object_keys(coalesce(p->'remarks','{}'::jsonb)) loop
    if k not in ('QT','INV','CA','BL','CN','DN','PO','RI','EXP') then raise exception 'ชนิดเอกสารสำหรับหมายเหตุไม่ถูกต้อง: %', k; end if;
    if length(p->'remarks'->>k) > 1000 then raise exception 'หมายเหตุยาวเกิน 1000 ตัวอักษร'; end if;
  end loop;
  update doc_settings set
    price_mode = coalesce(p->>'price_mode', price_mode), vat_level = coalesce(p->>'vat_level', vat_level),
    discount_level = coalesce(p->>'discount_level', discount_level), wht_level = coalesce(p->>'wht_level', wht_level),
    pur_vat_level = coalesce(p->>'pur_vat_level', pur_vat_level),
    pur_discount_level = coalesce(p->>'pur_discount_level', pur_discount_level),
    pur_wht_level = coalesce(p->>'pur_wht_level', pur_wht_level),
    show_warehouse = coalesce((p->>'show_warehouse')::boolean, show_warehouse),
    default_main_warehouse = coalesce((p->>'default_main_warehouse')::boolean, default_main_warehouse),
    qr_tax_request = coalesce((p->>'qr_tax_request')::boolean, qr_tax_request),
    qr_self_register = coalesce((p->>'qr_self_register')::boolean, qr_self_register),
    multi_currency = coalesce((p->>'multi_currency')::boolean, multi_currency),
    remarks = coalesce(p->'remarks', remarks), updated_at = now();
end $$;
