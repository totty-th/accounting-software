-- M18.8 ใบเสนอราคา (QT) เต็มรูปแบบ · ตาม REA FlowAccount 24-10-2026
-- หัวเอกสาร: เงื่อนไขชำระ (เครดิต(วัน)/เงินสด/เครดิต(ไม่แสดงวันที่)), พนักงานขาย, โปรเจกต์, เลขที่อ้างอิง, ราคารวม/ไม่รวมภาษี, รายละเอียด, คลัง, หมายเหตุ, โน้ตภายใน, ลายเซ็น
-- บรรทัด: หน่วย, ส่วนลด % หรือ บาท, ภาษี 7%/0%/ยกเว้น, หัก ณ ที่จ่ายต่อบรรทัด (ข้อมูลบนเอกสาร ไม่ลงบัญชี)
-- สถานะ: รออนุมัติ → อนุมัติแล้ว/ไม่อนุมัติ → ดำเนินการแล้ว · รีเซ็ต · สร้างซ้ำ
-- ยังไม่ทดสอบบน FA (จึงไม่ทำ): แก้ QT ที่อนุมัติแล้ว, การแสดงผล "เครดิต (ไม่แสดงวันที่)" บนเอกสาร, ซ่อนคอลัมน์ภาษี/หัก ณ ที่จ่ายตามตัวเลือกตั้งค่าเอกสาร
-- ข้อจำกัด: QT → ใบแจ้งหนี้ทำได้เมื่อทุกบรรทัดภาษี 7% ไม่มีส่วนลด และไม่หัก ณ ที่จ่าย (ใบแจ้งหนี้ของเรายังไม่มีฟีเจอร์เหล่านี้)

alter table sales_docs
  add column term_mode text not null default 'credit' check (term_mode in ('credit','cash','credit_nodate')),
  add column credit_days int not null default 0 check (credit_days >= 0),
  add column salesperson text, add column project text, add column ref_no text, add column description text,
  add column warehouse_id uuid references warehouses(id),
  add column show_signature boolean not null default true,
  add column note text,
  add column discount_total numeric(18,2) not null default 0,
  add column exempt_base numeric(18,2) not null default 0,
  add column wht_total numeric(18,2) not null default 0;
alter table sales_doc_lines
  add column unit text,
  add column discount_type text not null default 'percent' check (discount_type in ('percent','amount')),
  add column discount_value numeric(18,2) not null default 0 check (discount_value >= 0),
  add column discount numeric(18,2) not null default 0,
  add column vat_rate numeric(5,2),
  add column vat_exempt boolean not null default false,
  add column wht_rate numeric(5,2) not null default 0 check (wht_rate >= 0 and wht_rate <= 100),
  add column wht numeric(18,2) not null default 0;

-- สร้าง (p_id null) หรือแก้ไข (เฉพาะรออนุมัติ) ใบเสนอราคา
-- p_header: date, contact, term_mode, credit_days, salesperson, project, ref_no, description, price_mode, warehouse_id, show_signature, note, internal_note
-- p_lines[]: product_id?, description, unit, qty, unit_price, discount_type, discount_value, vat('7'|'0'|'exempt'), wht_rate
create function save_quotation(p_id uuid, p_header jsonb, p_lines jsonb) returns uuid language plpgsql as $$
declare v_id uuid := p_id; h jsonb := coalesce(p_header, '{}'); l jsonb; n int := 0; q sales_docs; pr products;
        v_date date := (h->>'date')::date; v_mode text := coalesce(nullif(h->>'price_mode',''), 'exclusive');
        v_term text := coalesce(nullif(h->>'term_mode',''), 'credit');
        v_cd int := coalesce(nullif(h->>'credit_days','')::int, 0);
        v_dt text; v_dv numeric; v_wr numeric; v_wht numeric; v_qty numeric; v_price numeric; v_desc text; v_pid uuid;
        c record; v_amt numeric;
        t_net numeric := 0; t_vat numeric := 0; t_disc numeric := 0; t_ex numeric := 0; t_wht numeric := 0;
begin
  if p_lines is null or jsonb_array_length(p_lines) = 0 then raise exception 'ต้องมีรายการอย่างน้อย 1 บรรทัด'; end if;
  if v_mode not in ('exclusive','inclusive') then raise exception 'ราคาสินค้า % ไม่ถูกต้อง', v_mode; end if;
  if v_term not in ('credit','cash','credit_nodate') then raise exception 'เงื่อนไขชำระ % ไม่ถูกต้อง', v_term; end if;
  if v_cd < 0 then raise exception 'เครดิตต้องไม่ติดลบ'; end if;
  if v_date is null then raise exception 'ต้องระบุวันที่'; end if;
  if nullif(h->>'contact','') is null then raise exception 'ต้องเลือกลูกค้า'; end if;
  if v_term = 'cash' then v_cd := 0; end if;
  if v_id is null then
    v_id := gen_random_uuid();
    insert into sales_docs(id, doc_type, doc_no, doc_date, contact_id, status)
    values (v_id, 'QT', next_doc_no('QT', v_date, true), v_date, (h->>'contact')::uuid, 'pending_approval');
  else
    select * into q from sales_docs where id = v_id and doc_type = 'QT' for update;
    if not found then raise exception 'ไม่พบใบเสนอราคา'; end if;
    if q.status <> 'pending_approval' then
      raise exception 'แก้ไขได้เฉพาะใบเสนอราคาที่รออนุมัติ (แก้ใบที่อนุมัติแล้ว/ดำเนินการแล้วยังไม่ทดสอบบน FA)';
    end if;
    delete from sales_doc_lines where doc_id = v_id;
  end if;
  for l in select * from jsonb_array_elements(p_lines) loop
    n := n + 1;
    v_pid := nullif(l->>'product_id','')::uuid; v_desc := nullif(btrim(coalesce(l->>'description','')), '');
    if v_pid is not null then
      select * into pr from products where id = v_pid;
      if not found then raise exception 'ไม่พบสินค้า (บรรทัด %)', n; end if;
      v_desc := coalesce(v_desc, pr.name);
    end if;
    if v_desc is null then raise exception 'บรรทัด % ต้องมีรายการหรือรายละเอียด', n; end if;
    v_qty := (l->>'qty')::numeric; v_price := coalesce(nullif(l->>'unit_price','')::numeric, 0);
    if v_qty is null or v_qty <= 0 then raise exception 'จำนวนต้องมากกว่า 0 (บรรทัด %)', n; end if;
    if v_price < 0 then raise exception 'ราคาต้องไม่ติดลบ (บรรทัด %)', n; end if;
    v_dt := coalesce(nullif(l->>'discount_type',''), 'percent'); v_dv := coalesce(nullif(l->>'discount_value','')::numeric, 0);
    v_wr := coalesce(nullif(l->>'wht_rate','')::numeric, 0);
    if v_wr < 0 or v_wr > 100 then raise exception 'อัตราหัก ณ ที่จ่ายไม่ถูกต้อง (บรรทัด %)', n; end if;
    select * into c from purchase_line_calc(v_qty, v_price, v_dt, v_dv, coalesce(nullif(l->>'vat',''), '7'), v_mode);
    v_wht := round(c.v_net * v_wr / 100, 2);
    v_amt := case when v_mode = 'exclusive' or c.v_exempt or c.v_rate = 0 then c.v_net else c.v_net + c.v_vat end;  -- มูลค่าบรรทัดที่แสดง (หลังส่วนลด)
    insert into sales_doc_lines(doc_id, line_no, description, item_kind, qty, unit_price, amount, product_id,
        unit, discount_type, discount_value, discount, vat_rate, vat_exempt, wht_rate, wht)
    values (v_id, n, v_desc, case when pr.kind is null or pr.kind = 'service' then 'service' else 'goods' end, v_qty, v_price, v_amt,
        v_pid, coalesce(nullif(l->>'unit',''), case when v_pid is not null then pr.base_unit end), v_dt, v_dv, c.v_disc,
        c.v_rate, c.v_exempt, v_wr, v_wht);
    pr := null;
    t_net := t_net + c.v_net; t_vat := t_vat + c.v_vat; t_disc := t_disc + c.v_disc; t_wht := t_wht + v_wht;
    if c.v_exempt then t_ex := t_ex + c.v_net; end if;
  end loop;
  update sales_docs set doc_date = v_date, contact_id = (h->>'contact')::uuid, price_mode = v_mode, vat_rate = 7,
      term_mode = v_term, credit_days = v_cd, due_date = case when v_term = 'credit' then v_date + v_cd end,
      salesperson = nullif(h->>'salesperson',''), project = nullif(h->>'project',''), ref_no = nullif(h->>'ref_no',''),
      description = nullif(h->>'description',''), warehouse_id = nullif(h->>'warehouse_id','')::uuid,
      show_signature = coalesce((h->>'show_signature')::boolean, true), note = nullif(h->>'note',''),
      internal_note = nullif(h->>'internal_note',''),
      subtotal = t_net, vat = t_vat, total = t_net + t_vat, discount_total = t_disc, exempt_base = t_ex, wht_total = t_wht
    where id = v_id;
  return v_id;
end $$;

-- ไม่อนุมัติ: เฉพาะรออนุมัติ/อนุมัติแล้ว (ยังไม่สร้างใบแจ้งหนี้)
create function reject_quotation(p_id uuid) returns void language plpgsql as $$
begin
  update sales_docs set status = 'rejected' where id = p_id and doc_type = 'QT' and status in ('pending_approval','approved');
  if not found then raise exception 'ไม่อนุมัติได้เฉพาะใบเสนอราคาที่รออนุมัติหรืออนุมัติแล้ว'; end if;
end $$;

-- รีเซ็ต: ไม่อนุมัติ/อนุมัติแล้ว → รออนุมัติ (ห้ามถ้ามีใบแจ้งหนี้ที่ยังไม่ยกเลิกผูกอยู่)
create function reset_quotation(p_id uuid) returns void language plpgsql as $$
begin
  if exists (select 1 from sales_docs where ref_doc_id = p_id and doc_type = 'INV' and status <> 'cancelled') then
    raise exception 'ใบเสนอราคามีใบแจ้งหนี้ผูกอยู่ ต้องยกเลิกใบแจ้งหนี้ก่อน';
  end if;
  update sales_docs set status = 'pending_approval' where id = p_id and doc_type = 'QT' and status in ('rejected','approved');
  if not found then raise exception 'รีเซ็ตได้เฉพาะใบเสนอราคาที่อนุมัติแล้วหรือไม่อนุมัติ'; end if;
end $$;

-- สร้างซ้ำ: คัดลอกหัว/รายการ ใช้วันที่ใหม่ (สถานะรออนุมัติ)
create function duplicate_quotation(p_id uuid, p_date date default null) returns uuid language plpgsql as $$
declare q sales_docs; v_lines jsonb;
begin
  select * into q from sales_docs where id = p_id and doc_type = 'QT';
  if not found then raise exception 'ไม่พบใบเสนอราคา'; end if;
  select jsonb_agg(jsonb_build_object('product_id', product_id, 'description', description, 'unit', unit, 'qty', qty,
           'unit_price', unit_price, 'discount_type', discount_type, 'discount_value', discount_value,
           'vat', case when vat_exempt then 'exempt' else trim_scale(coalesce(vat_rate, 7))::text end, 'wht_rate', wht_rate) order by line_no)
    into v_lines from sales_doc_lines where doc_id = p_id;
  return save_quotation(null, jsonb_build_object('date', coalesce(p_date, today_th()), 'contact', q.contact_id, 'term_mode', q.term_mode,
    'credit_days', q.credit_days, 'salesperson', q.salesperson, 'project', q.project, 'ref_no', q.ref_no, 'description', q.description,
    'price_mode', q.price_mode, 'warehouse_id', q.warehouse_id, 'show_signature', q.show_signature, 'note', q.note,
    'internal_note', q.internal_note), v_lines);
end $$;

-- QT → ใบแจ้งหนี้: ใบแจ้งหนี้ของเรายังไม่รองรับส่วนลด/ภาษี 0%·ยกเว้น/หัก ณ ที่จ่ายต่อบรรทัด จึงกันไว้ไม่ให้ยอดเพี้ยน
create or replace function quotation_to_invoice(p_qt uuid, p_date date) returns uuid language plpgsql as $$
declare q sales_docs; v_inv uuid; v_lines jsonb;
begin
  select * into q from sales_docs where id = p_qt and doc_type = 'QT';
  if not found or q.status <> 'approved' then raise exception 'ต้องเป็นใบเสนอราคาที่อนุมัติแล้ว'; end if;
  if exists (select 1 from sales_doc_lines where doc_id = p_qt
              and (discount > 0 or wht_rate > 0 or vat_exempt or coalesce(vat_rate, 7) <> 7)) then
    raise exception 'ใบเสนอราคาที่มีส่วนลด ภาษี 0%%/ยกเว้น หรือหัก ณ ที่จ่าย แปลงเป็นใบแจ้งหนี้ยังไม่รองรับ (ใบแจ้งหนี้ยังไม่มีฟีเจอร์เหล่านี้)';
  end if;
  select jsonb_agg(jsonb_build_object('description',description,'kind',item_kind,'qty',qty,'unit_price',unit_price,'product_id',product_id,
           'warehouse_id', coalesce(warehouse_id, q.warehouse_id)) order by line_no)
    into v_lines from sales_doc_lines where doc_id = p_qt;
  v_inv := create_sales_doc('INV', p_date, q.contact_id, v_lines, q.price_mode, q.vat_rate, p_qt);
  update sales_docs set status = 'converted' where id = p_qt;
  return v_inv;
end $$;

-- มุมมองเอกสารขาย: เพิ่มฟิลด์ของ QT เต็มรูปแบบ (ส่วนอื่นเหมือน 0010)
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
      'discount_total', d.discount_total, 'exempt_base', d.exempt_base, 'wht_total', d.wht_total),
    'contact', jsonb_build_object('id', c.id, 'name', coalesce(nullif(c.business_name,''), c.contact_name),
      'address', c.address, 'tax_id', c.tax_id, 'credit_days', c.credit_days),
    'company', (select jsonb_build_object('name', name, 'address', address, 'tax_id', tax_id) from company_profile limit 1),
    'lines', coalesce((select jsonb_agg(jsonb_build_object('line_no', line_no, 'description', description,
        'item_kind', item_kind, 'qty', qty, 'unit_price', unit_price, 'amount', amount, 'unit', unit,
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
