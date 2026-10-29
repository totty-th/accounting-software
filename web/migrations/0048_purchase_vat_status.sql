create table purchase_vat_flags (
  doc_type text not null check (doc_type in ('EXP','RI')), doc_id uuid not null,
  flag text not null check (flag in ('pp36','receipt','waived')),
  updated_at timestamptz not null default now(),
  primary key (doc_type, doc_id)
);
create function set_purchase_vat_status(p_type text, p_doc uuid, p_status text, p jsonb default '{}'::jsonb) returns void language plpgsql as $$
declare v_vat numeric;
begin
  if p_type = 'EXP' then select vat into v_vat from expenses where id = p_doc and status not in ('rejected','cancelled');
  elsif p_type = 'RI' then select vat into v_vat from goods_receipts where id = p_doc and status not in ('rejected','cancelled');
  else raise exception 'ชนิดเอกสารไม่ถูกต้อง'; end if;
  if v_vat is null then raise exception 'ไม่พบเอกสาร หรือเอกสารไม่อนุมัติ/ยกเลิกแล้ว'; end if;
  if v_vat <= 0 then raise exception 'เอกสารนี้ไม่มี VAT'; end if;
  if p_status = 'received' then
    perform set_purchase_tax_invoice(p_type, p_doc, p);
    delete from purchase_vat_flags where doc_type = p_type and doc_id = p_doc;
  elsif p_status = 'wait' then
    perform clear_purchase_tax_invoice(p_type, p_doc);
    delete from purchase_vat_flags where doc_type = p_type and doc_id = p_doc;
  elsif p_status in ('pp36','receipt','waived') then
    insert into purchase_vat_flags(doc_type, doc_id, flag) values (p_type, p_doc, p_status)
    on conflict (doc_type, doc_id) do update set flag = excluded.flag, updated_at = now();
  else raise exception 'สถานะไม่ถูกต้อง'; end if;
end $$;
