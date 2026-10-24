create or replace function wht_share(p_inv uuid, p_amount numeric) returns numeric language plpgsql stable as $$
declare i sales_docs; v_total numeric; v_already numeric;
begin
  select * into i from sales_docs where id = p_inv;
  v_total := case when i.wht_total > 0 then i.wht_total else round(i.subtotal * i.wht_rate / 100, 2) end;
  if v_total = 0 then return 0; end if;
  if p_amount >= i.total - doc_receipted(p_inv) then
    select coalesce(sum(ri.wht),0) into v_already from receipt_items ri join receipts r on r.id = ri.receipt_id
     where ri.doc_id = p_inv and r.status <> 'cancelled';
    return v_total - v_already;
  end if;
  return round(v_total * p_amount / i.total, 2);
end $$;
create or replace function create_invoice_full(p_header jsonb, p_lines jsonb, p_ref uuid default null) returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid(); h jsonb := coalesce(p_header, '{}'); l jsonb; n int := 0; pr products;
        v_date date := (h->>'date')::date; v_mode text := coalesce(nullif(h->>'price_mode',''), 'exclusive');
        v_term text := coalesce(nullif(h->>'term_mode',''), 'credit');
        v_cd int := coalesce(nullif(h->>'credit_days','')::int, 0);
        v_dt text; v_dv numeric; v_wr numeric; v_wht numeric; v_qty numeric; v_price numeric; v_desc text; v_pid uuid; v_detail text; v_auto boolean;
        v_wh uuid := nullif(h->>'warehouse_id','')::uuid;
        c record; v_amt numeric;
        t_net numeric := 0; t_vat numeric := 0; t_disc numeric := 0; t_ex numeric := 0; t_wht numeric := 0; t_goods numeric := 0; t_serv numeric := 0;
        v_total numeric; v_rev jsonb := '[]'::jsonb; v_voucher uuid;
begin
  if p_lines is null or jsonb_array_length(p_lines) = 0 then raise exception 'ต้องมีรายการอย่างน้อย 1 บรรทัด'; end if;
  if v_mode not in ('exclusive','inclusive') then raise exception 'ราคาสินค้า % ไม่ถูกต้อง', v_mode; end if;
  if v_term not in ('credit','credit_nodate') then raise exception 'เงื่อนไขชำระ % ไม่ถูกต้อง', v_term; end if;
  if v_date is null then raise exception 'ต้องระบุวันที่'; end if;
  if nullif(h->>'contact','') is null then raise exception 'ต้องเลือกลูกค้า'; end if;
  if nullif(h->>'due_date','') is not null then v_cd := (h->>'due_date')::date - v_date; end if;   -- แก้วันครบกำหนดตรง ๆ = เครดิตเปลี่ยนตาม (FA)
  if v_cd < 0 then raise exception 'วันครบกำหนดต้องไม่ก่อนวันที่ของเอกสาร'; end if;
  insert into sales_docs(id, doc_type, doc_no, doc_date, contact_id, status, ref_doc_id)
  values (v_id, 'INV', next_doc_no('INV', v_date, true), v_date, (h->>'contact')::uuid, 'awaiting_payment', p_ref);
  for l in select * from jsonb_array_elements(p_lines) loop
    n := n + 1;
    v_auto := false; v_pid := nullif(l->>'product_id','')::uuid; v_desc := nullif(btrim(coalesce(l->>'description','')), '');
    if v_pid is not null then
      select * into pr from products where id = v_pid;
      if not found then raise exception 'ไม่พบสินค้า (บรรทัด %)', n; end if;
      v_desc := coalesce(v_desc, pr.name);
    end if;
    if v_desc is null then raise exception 'บรรทัด % ต้องมีรายการหรือรายละเอียด', n; end if;
    v_detail := nullif(btrim(coalesce(l->>'detail','')), '');
    if v_pid is null then   -- ตาม FA: ชื่อที่พิมพ์เองถูกสร้างเป็นสินค้าประเภทบริการ (ใช้ตัวเดิมถ้าชื่อซ้ำ)
      select * into pr from products where lower(name) = lower(v_desc) and is_active order by code limit 1;
      if found then v_pid := pr.id;
      else
        insert into products(code, name, kind, sale_price) values ('NEW-' || substr(md5(random()::text || clock_timestamp()::text), 1, 8), v_desc, 'service',
          coalesce(nullif(l->>'unit_price','')::numeric, 0)) returning * into pr;
        v_pid := pr.id; v_auto := true;
      end if;
    end if;
    v_qty := (l->>'qty')::numeric; v_price := coalesce(nullif(l->>'unit_price','')::numeric, 0);
    if v_qty is null or v_qty <= 0 then raise exception 'จำนวนต้องมากกว่า 0 (บรรทัด %)', n; end if;
    if v_price < 0 then raise exception 'ราคาต้องไม่ติดลบ (บรรทัด %)', n; end if;
    v_dt := coalesce(nullif(l->>'discount_type',''), 'percent'); v_dv := coalesce(nullif(l->>'discount_value','')::numeric, 0);
    v_wr := coalesce(nullif(l->>'wht_rate','')::numeric, 0);
    if v_wr < 0 or v_wr > 100 then raise exception 'อัตราหัก ณ ที่จ่ายไม่ถูกต้อง (บรรทัด %)', n; end if;
    select * into c from purchase_line_calc(v_qty, v_price, v_dt, v_dv, coalesce(nullif(l->>'vat',''), '7'), v_mode);
    v_wht := round(c.v_net * v_wr / 100, 2);
    v_amt := case when v_mode = 'exclusive' or c.v_exempt or c.v_rate = 0 then c.v_net else c.v_net + c.v_vat end;
    insert into sales_doc_lines(doc_id, line_no, description, detail, item_kind, qty, unit_price, amount, product_id, warehouse_id,
        unit, discount_type, discount_value, discount, vat_rate, vat_exempt, wht_rate, wht)
    values (v_id, n, v_desc, v_detail, case when pr.kind = 'service' then 'service' else 'goods' end, v_qty, v_price, v_amt, v_pid,
        coalesce(nullif(l->>'warehouse_id','')::uuid, v_wh),
        coalesce(nullif(l->>'unit',''), case when not v_auto then pr.base_unit end), v_dt, v_dv, c.v_disc, c.v_rate, c.v_exempt, v_wr, v_wht);
    if pr.kind = 'service' then t_serv := t_serv + c.v_net; else t_goods := t_goods + c.v_net; end if;
    pr := null;
    t_net := t_net + c.v_net; t_vat := t_vat + c.v_vat; t_disc := t_disc + c.v_disc; t_wht := t_wht + v_wht;
    if c.v_exempt then t_ex := t_ex + c.v_net; end if;
  end loop;
  v_total := t_net + t_vat;
  if v_total <= 0 then raise exception 'ยอดรวมต้องมากกว่า 0'; end if;   -- FA บันทึกยอด 0.00 ได้ แต่เราไม่ลงรายการบัญชีศูนย์บาท
  update sales_docs set price_mode = v_mode, vat_rate = 7,
      term_mode = v_term, credit_days = v_cd, due_date = case when v_term = 'credit' then v_date + v_cd end,
      salesperson = nullif(h->>'salesperson',''), project = nullif(h->>'project',''), ref_no = nullif(h->>'ref_no',''),
      description = nullif(h->>'description',''), warehouse_id = v_wh,
      show_signature = coalesce((h->>'show_signature')::boolean, true), note = nullif(h->>'note',''),
      internal_note = nullif(h->>'internal_note',''),
      subtotal = t_net, vat = t_vat, total = v_total, discount_total = t_disc, exempt_base = t_ex, wht_total = t_wht
    where id = v_id;
  if t_goods > 0 then v_rev := v_rev || jsonb_build_object('account','41110','credit',t_goods); end if;
  if t_serv  > 0 then v_rev := v_rev || jsonb_build_object('account','41210','credit',t_serv);  end if;
  if t_vat   > 0 then v_rev := v_rev || jsonb_build_object('account','27111','credit',t_vat);   end if;
  v_voucher := post_voucher('SV', v_date, null, 'INV', v_id::text,
    jsonb_build_array(jsonb_build_object('account','11311','debit',v_total)) || v_rev);
  update sales_docs set voucher_id = v_voucher where id = v_id;
  perform stock_issue_for_doc(v_id);
  return v_id;
end $$;
create or replace function duplicate_invoice(p_id uuid, p_date date default null) returns uuid language plpgsql as $$
declare q sales_docs; v_lines jsonb;
begin
  select * into q from sales_docs where id = p_id and doc_type = 'INV';
  if not found then raise exception 'ไม่พบใบแจ้งหนี้'; end if;
  if not exists (select 1 from sales_doc_lines where doc_id = p_id and vat_rate is not null) then
    raise exception 'ใบแจ้งหนี้แบบเก่าสร้างซ้ำไม่ได้';
  end if;
  select jsonb_agg(jsonb_build_object('product_id', product_id, 'description', description, 'detail', detail, 'unit', unit, 'qty', qty,
           'unit_price', unit_price, 'discount_type', discount_type, 'discount_value', discount_value, 'warehouse_id', warehouse_id,
           'vat', case when vat_exempt then 'exempt' else trim_scale(coalesce(vat_rate, 7))::text end, 'wht_rate', wht_rate) order by line_no)
    into v_lines from sales_doc_lines where doc_id = p_id;
  return create_invoice_full(jsonb_build_object('date', coalesce(p_date, today_th()), 'contact', q.contact_id, 'term_mode', q.term_mode,
    'credit_days', q.credit_days, 'salesperson', q.salesperson, 'project', q.project, 'ref_no', q.ref_no, 'description', q.description,
    'price_mode', q.price_mode, 'warehouse_id', q.warehouse_id, 'show_signature', q.show_signature, 'note', q.note,
    'internal_note', q.internal_note), v_lines);
end $$;
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
  return v_inv;
end $$;
