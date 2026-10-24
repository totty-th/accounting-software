-- M18.10 ใบส่งของ (พิมพ์จากใบเสนอราคาที่อนุมัติแล้ว / ใบแจ้งหนี้) · ตาม REA FlowAccount 24-10-2026 + ขั้นตอนที่เจ้าของระบบกำหนด
-- FA: ในหน้าพิมพ์มีตัวเลือก "ใบส่งของ" = เอกสารแบบเดียวกันแต่ไม่มีราคา (#/รายละเอียด/จำนวน, ผู้รับสินค้า/ผู้ส่งสินค้า)
-- ส่วนเพิ่มของเรา (FA ไม่มี): ฝ่ายขายกรอกข้อมูลจัดส่งหลังใบเสนอราคาอนุมัติ — รับเอง หรือ ส่งให้ (ชื่อผู้รับ/ที่อยู่/เบอร์/ขนส่ง) ที่อยู่ส่งต่างจากที่อยู่เปิดบิลได้
-- ข้อสันนิษฐานที่ยังไม่ได้ยืนยันกับเจ้าของ: ส่งให้ต้องมี ชื่อผู้รับ + ที่อยู่; เบอร์/ขนส่ง/หมายเหตุไม่บังคับ; รับเอง ไม่บังคับอะไร
alter table sales_docs add column delivery_mode text check (delivery_mode in ('pickup','ship')),
  add column ship_name text, add column ship_address text, add column ship_phone text, add column carrier text, add column delivery_note text;

alter table doc_events drop constraint doc_events_event_check;
alter table doc_events add constraint doc_events_event_check
  check (event in ('created','status','note','file_added','file_removed','wht','delivery'));

create or replace function set_delivery(p_id uuid, p jsonb) returns void language plpgsql as $$
declare d sales_docs; m text := nullif(p->>'mode','');
        n text := nullif(btrim(coalesce(p->>'name','')),''); a text := nullif(btrim(coalesce(p->>'address','')),'');
begin
  select * into d from sales_docs where id = p_id;
  if not found then raise exception 'ไม่พบเอกสาร'; end if;
  if not ((d.doc_type = 'QT' and d.status in ('approved','converted')) or (d.doc_type = 'INV' and d.status <> 'cancelled')) then
    raise exception 'กรอกข้อมูลจัดส่งได้เมื่อใบเสนอราคาอนุมัติแล้ว หรือกับใบแจ้งหนี้ที่ไม่ได้ยกเลิก';
  end if;
  if m is null then   -- ล้างข้อมูลจัดส่ง
    update sales_docs set delivery_mode = null, ship_name = null, ship_address = null, ship_phone = null, carrier = null, delivery_note = null where id = p_id;
  else
    if m not in ('pickup','ship') then raise exception 'วิธีรับสินค้า % ไม่ถูกต้อง', m; end if;
    if m = 'ship' and (n is null or a is null) then raise exception 'ส่งให้ลูกค้า ต้องระบุชื่อผู้รับและที่อยู่ที่ส่ง'; end if;
    update sales_docs set delivery_mode = m, ship_name = n,
        ship_address = case when m = 'ship' then a end,
        ship_phone = nullif(btrim(coalesce(p->>'phone','')),''),
        carrier = case when m = 'ship' then nullif(btrim(coalesce(p->>'carrier','')),'') end,
        delivery_note = nullif(btrim(coalesce(p->>'note','')),'')
      where id = p_id;
  end if;
  insert into doc_events(doc_id, event, detail, actor_id) values (p_id, 'delivery', m, doc_event_actor());
end $$;

-- ข้อมูลจัดส่งตามไปกับใบแจ้งหนี้ตอนแปลงจาก QT
create or replace function quotation_to_invoice(p_qt uuid, p_date date) returns uuid language plpgsql as $$
declare q sales_docs; v_inv uuid; v_lines jsonb;
begin
  select * into q from sales_docs where id = p_qt and doc_type = 'QT';
  if not found or q.status <> 'approved' then raise exception 'ต้องเป็นใบเสนอราคาที่อนุมัติแล้ว'; end if;
  select jsonb_agg(jsonb_build_object('product_id', product_id, 'description', description, 'detail', detail, 'unit', unit, 'qty', qty,
           'unit_price', unit_price, 'discount_type', discount_type, 'discount_value', discount_value,
           'warehouse_id', coalesce(warehouse_id, q.warehouse_id),
           'vat', case when vat_exempt then 'exempt' else trim_scale(coalesce(vat_rate, 7))::text end, 'wht_rate', wht_rate) order by line_no)
    into v_lines from sales_doc_lines where doc_id = p_qt;
  v_inv := create_invoice_full(jsonb_build_object('date', p_date, 'contact', q.contact_id,
    'term_mode', case when q.term_mode = 'credit_nodate' then 'credit_nodate' else 'credit' end,
    'credit_days', case when q.term_mode = 'cash' then 0 else q.credit_days end,
    'salesperson', q.salesperson, 'project', q.project, 'ref_no', q.ref_no, 'description', q.description,
    'price_mode', q.price_mode, 'warehouse_id', q.warehouse_id, 'show_signature', q.show_signature, 'note', q.note,
    'internal_note', q.internal_note), v_lines, p_qt);
  update sales_docs set status = 'converted' where id = p_qt;
  update sales_docs set delivery_mode = q.delivery_mode, ship_name = q.ship_name, ship_address = q.ship_address, ship_phone = q.ship_phone,
      carrier = q.carrier, delivery_note = q.delivery_note where id = v_inv;   -- ข้อมูลการจัดส่งตามไปกับใบแจ้งหนี้
  return v_inv;
end $$;

-- มุมมองเอกสารขาย: เพิ่มฟิลด์จัดส่ง
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
      'deposit_net', d.deposit_net, 'deposit_vat', d.deposit_vat, 'wht_rate', d.wht_rate,
      'term_mode', d.term_mode, 'credit_days', d.credit_days, 'salesperson_name', d.salesperson, 'project', d.project,
      'ref_no', d.ref_no, 'description', d.description, 'show_signature', d.show_signature, 'note', d.note,
      'discount_total', d.discount_total, 'exempt_base', d.exempt_base, 'wht_total', d.wht_total,
      'delivery_mode', d.delivery_mode, 'ship_name', d.ship_name, 'ship_address', d.ship_address, 'ship_phone', d.ship_phone,
      'carrier', d.carrier, 'delivery_note', d.delivery_note),
    'contact', jsonb_build_object('id', c.id, 'name', coalesce(nullif(c.business_name,''), c.contact_name),
      'address', c.address, 'tax_id', c.tax_id, 'credit_days', c.credit_days),
    'company', (select jsonb_build_object('name', name, 'address', address, 'tax_id', tax_id) from company_profile limit 1),
    'lines', coalesce((select jsonb_agg(jsonb_build_object('line_no', line_no, 'description', description,
        'item_kind', item_kind, 'detail', detail, 'qty', qty, 'unit_price', unit_price, 'amount', amount, 'unit', unit,
        'discount', discount, 'discount_type', discount_type, 'discount_value', discount_value,
        'vat_rate', vat_rate, 'vat_exempt', vat_exempt, 'wht_rate', wht_rate, 'wht', wht) order by line_no)
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

