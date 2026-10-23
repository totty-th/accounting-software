-- M10: ข้อมูลเพิ่มสำหรับเอกสาร A4 ให้ครบรายละเอียด (ไม่แตะรายการบัญชี)
-- ปรับ sales_doc_view: เอกสารอ้างอิงมีวันที่/มูลค่า (ใช้แสดง "วันที่อ้างอิง" และ มูลค่าตามเอกสารเดิม/ที่ถูกต้อง/ผลต่าง ของใบลดหนี้-เพิ่มหนี้)
create or replace function sales_doc_view(p_id uuid) returns jsonb language plpgsql stable as $$
declare d sales_docs; c contacts; v jsonb;
begin
  select * into d from sales_docs where id = p_id;
  if not found then raise exception 'ไม่พบเอกสาร'; end if;
  select * into c from contacts where id = d.contact_id;
  select jsonb_build_object(
    'doc', jsonb_build_object('id', d.id, 'doc_type', d.doc_type, 'doc_no', d.doc_no, 'doc_date', d.doc_date,
      'due_date', d.due_date, 'status', d.status, 'price_mode', d.price_mode, 'vat_rate', d.vat_rate,
      'subtotal', d.subtotal, 'vat', d.vat, 'total', d.total, 'reason', d.reason, 'is_deposit', d.is_deposit,
      'deposit_net', d.deposit_net, 'deposit_vat', d.deposit_vat, 'wht_rate', d.wht_rate),
    'contact', jsonb_build_object('id', c.id, 'name', coalesce(nullif(c.business_name,''), c.contact_name),
      'address', c.address, 'tax_id', c.tax_id, 'credit_days', c.credit_days),
    'company', (select jsonb_build_object('name', name, 'address', address, 'tax_id', tax_id) from company_profile limit 1),
    'lines', coalesce((select jsonb_agg(jsonb_build_object('line_no', line_no, 'description', description,
        'item_kind', item_kind, 'qty', qty, 'unit_price', unit_price, 'amount', amount) order by line_no)
      from sales_doc_lines where doc_id = d.id), '[]'::jsonb),
    'ref', (select jsonb_build_object('id', r.id, 'doc_no', r.doc_no, 'doc_type', r.doc_type, 'doc_date', r.doc_date,
        'subtotal', r.subtotal, 'total', r.total) from sales_docs r where r.id = d.ref_doc_id),
    'children', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'doc_no', x.doc_no, 'doc_type', x.doc_type, 'status', x.status)
        order by x.doc_date, x.doc_no) from sales_docs x where x.ref_doc_id = d.id), '[]'::jsonb),
    'receipts', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'receipt_no', r.receipt_no, 'status', r.status,
        'receipt_date', r.receipt_date, 'collected_date', r.collected_date, 'amount', ri.amount) order by r.receipt_date, r.receipt_no)
      from receipt_items ri join receipts r on r.id = ri.receipt_id where ri.doc_id = d.id and r.status <> 'cancelled'), '[]'::jsonb),
    'vouchers', coalesce((select jsonb_agg(jsonb_build_object('id', j.id, 'voucher_no', j.voucher_no))
      from journal_vouchers j where j.id in (d.voucher_id, d.collect_voucher_id)), '[]'::jsonb)
  ) into v;
  return v;
end $$;

-- ใบเสร็จรับเงิน: ข้อมูลสำหรับพิมพ์ A4 (รายการเอกสารที่รับชำระ ยอด หัก ณ ที่จ่าย และแยกภาษีจากยอดรวม)
create function receipt_view(p_id uuid) returns jsonb language plpgsql stable as $$
declare r receipts; c contacts; v jsonb; rate numeric; vat numeric;
begin
  select * into r from receipts where id = p_id;
  if not found then raise exception 'ไม่พบใบเสร็จ'; end if;
  select * into c from contacts where id = r.contact_id;
  select max(d.vat_rate) into rate from receipt_items i join sales_docs d on d.id = i.doc_id where i.receipt_id = r.id;
  -- ยอดรับเป็นยอดรวมภาษีแล้ว: ภาษี = ยอด × อัตรา ÷ (100 + อัตรา) ปัดเศษ 2 ตำแหน่ง
  vat := case when rate is null then 0 else round(r.amount * rate / (100 + rate), 2) end;
  select jsonb_build_object(
    'receipt', jsonb_build_object('id', r.id, 'receipt_no', r.receipt_no, 'kind', r.kind, 'receipt_date', r.receipt_date,
      'status', r.status, 'amount', r.amount, 'wht', r.wht, 'collected_date', r.collected_date,
      'vat_rate', rate, 'vat', vat, 'base', r.amount - vat),
    'contact', jsonb_build_object('id', c.id, 'name', coalesce(nullif(c.business_name,''), c.contact_name),
      'address', c.address, 'tax_id', c.tax_id),
    'company', (select jsonb_build_object('name', name, 'address', address, 'tax_id', tax_id) from company_profile limit 1),
    'items', coalesce((select jsonb_agg(jsonb_build_object('line_no', i.line_no, 'doc_no', d.doc_no, 'doc_date', d.doc_date,
        'due_date', d.due_date, 'doc_total', d.total, 'description', i.description, 'amount', i.amount, 'wht', i.wht)
        order by i.line_no)
      from receipt_items i left join sales_docs d on d.id = i.doc_id where i.receipt_id = r.id), '[]'::jsonb)
  ) into v;
  return v;
end $$;
