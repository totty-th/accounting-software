-- M67 ภาษีขายคิดจากยอดรวมทั้งใบ (เจ้าของระบบอนุมัติ 18-11-2026 "ยอดรวมทั้งใบได้")
-- เดิม: VAT = ผลรวม round(VAT รายบรรทัด) → ต่างจาก 7% ของยอดรวมได้ระดับสตางค์ (รายงานตรวจประเมิน B-15)
-- ใหม่: VAT = round(มูลค่าที่คำนวณภาษีทั้งใบ × 7%) · ราคารวม VAT: VAT = round(ยอดรวมที่เสียภาษี × 7/107) และมูลค่าก่อนภาษี = ยอดรวม − VAT
-- รายการยกเว้น/0% ไม่นำมาคิด · ฝั่งซื้อไม่เปลี่ยน (บันทึกตามใบกำกับของผู้ขาย)
create or replace function save_quotation(p_id uuid, p_header jsonb, p_lines jsonb) returns uuid language plpgsql as $$
declare v_id uuid := p_id; h jsonb := coalesce(p_header, '{}'); l jsonb; n int := 0; q sales_docs; pr products;
        v_date date := (h->>'date')::date; v_mode text := coalesce(nullif(h->>'price_mode',''), 'exclusive');
        v_term text := coalesce(nullif(h->>'term_mode',''), 'credit');
        v_cd int := coalesce(nullif(h->>'credit_days','')::int, 0);
        v_dt text; v_dv numeric; v_wr numeric; v_wht numeric; v_qty numeric; v_price numeric; v_desc text; v_pid uuid; v_detail text; v_auto boolean;
        c record; c0 record; v_amt numeric; v_on numeric; t_on numeric := 0; v_alloc numeric[];
        t_net numeric := 0; t_vat numeric := 0; t_tx numeric := 0; v_vt numeric; t_disc numeric := 0; t_ex numeric := 0; t_wht numeric := 0;
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
  v_alloc := sales_ontop_alloc(p_lines, v_mode, nullif(h->>'ontop_type',''), coalesce(nullif(h->>'ontop_value','')::numeric, 0));
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
    if v_pid is null then   -- ตาม FA: ชื่อที่พิมพ์เองจะถูกสร้างเป็นสินค้าประเภทบริการในรายการสินค้า (ใช้ตัวเดิมถ้าชื่อซ้ำ)
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
    select * into c0 from purchase_line_calc(v_qty, v_price, v_dt, v_dv, coalesce(nullif(l->>'vat',''), '7'), v_mode);
    v_on := coalesce(v_alloc[n], nullif(l->>'ontop','')::numeric, 0);   -- ส่วนลด On Top ที่ปันมาบรรทัดนี้
    if v_on < 0 then raise exception 'ส่วนลด On Top ต้องไม่ติดลบ (บรรทัด %)', n; end if;
    if v_on > 0 then select * into c from purchase_line_calc(v_qty, v_price, 'amount', c0.v_disc + v_on, coalesce(nullif(l->>'vat',''), '7'), v_mode);
    else c := c0; end if;
    t_on := t_on + v_on;
    v_wht := round(c.v_net * v_wr / 100, 2);
    v_amt := case when v_mode = 'exclusive' or c.v_exempt or c.v_rate = 0 then c.v_net else c.v_net + c.v_vat end;  -- มูลค่าบรรทัดที่แสดง (หลังส่วนลด)
    insert into sales_doc_lines(doc_id, line_no, description, detail, item_kind, qty, unit_price, amount, product_id,
        unit, discount_type, discount_value, discount, vat_rate, vat_exempt, wht_rate, wht, ontop)
    values (v_id, n, v_desc, v_detail, case when pr.kind is null or pr.kind = 'service' then 'service' else 'goods' end, v_qty, v_price, v_amt,
        v_pid, coalesce(nullif(l->>'unit',''), case when v_pid is not null and not v_auto then pr.base_unit end), v_dt, v_dv, c0.v_disc,
        c.v_rate, c.v_exempt, v_wr, v_wht, v_on);
    pr := null;
    t_net := t_net + c.v_net; t_vat := t_vat + c.v_vat; if not c.v_exempt and c.v_rate > 0 then t_tx := t_tx + c.v_net + case when v_mode = 'exclusive' then 0 else c.v_vat end; end if; t_disc := t_disc + c.v_disc; t_wht := t_wht + v_wht;
    if c.v_exempt then t_ex := t_ex + c.v_net; end if;
  end loop;
  -- M67: ภาษีขายคิดจากยอดรวมทั้งใบ (มูลค่าที่คำนวณภาษี 7% รวมทุกบรรทัด) แทนผลรวมภาษีรายบรรทัด
  v_vt := case when v_mode = 'exclusive' then round(t_tx * 7 / 100, 2) else round(t_tx * 7 / 107, 2) end;
  if v_mode <> 'exclusive' then t_net := t_net + t_vat - v_vt; end if;
  t_vat := v_vt;
  update sales_docs set doc_date = v_date, contact_id = (h->>'contact')::uuid, price_mode = v_mode, vat_rate = 7,
      term_mode = v_term, credit_days = v_cd, due_date = case when v_term = 'credit' then v_date + v_cd end,
      salesperson = nullif(h->>'salesperson',''), project = nullif(h->>'project',''), ref_no = nullif(h->>'ref_no',''),
      description = nullif(h->>'description',''), warehouse_id = nullif(h->>'warehouse_id','')::uuid,
      show_signature = coalesce((h->>'show_signature')::boolean, true), note = nullif(h->>'note',''),
      internal_note = nullif(h->>'internal_note',''),
      subtotal = t_net, vat = t_vat, total = t_net + t_vat, discount_total = t_disc, exempt_base = t_ex, wht_total = t_wht,
      ontop_type = case when t_on > 0 then coalesce(nullif(h->>'ontop_type',''), 'amount') end,
      ontop_value = case when t_on = 0 then 0 when nullif(h->>'ontop_type','') is null then t_on else coalesce(nullif(h->>'ontop_value','')::numeric, 0) end,
      ontop_total = t_on
    where id = v_id;
  return v_id;
end $$;

create or replace function create_invoice_full(p_header jsonb, p_lines jsonb, p_ref uuid default null, p_type text default 'INV', p_edit uuid default null) returns uuid language plpgsql as $$
declare v_id uuid := coalesce(p_edit, gen_random_uuid()); v_old sales_docs; v_oldv uuid; h jsonb := coalesce(p_header, '{}'); l jsonb; n int := 0; pr products;
        v_date date := (h->>'date')::date; v_mode text := coalesce(nullif(h->>'price_mode',''), 'exclusive');
        v_term text := coalesce(nullif(h->>'term_mode',''), 'credit');
        v_cd int := coalesce(nullif(h->>'credit_days','')::int, 0);
        v_dt text; v_dv numeric; v_wr numeric; v_wht numeric; v_qty numeric; v_price numeric; v_desc text; v_pid uuid; v_detail text; v_auto boolean;
        v_wh uuid := nullif(h->>'warehouse_id','')::uuid;
        c record; c0 record; v_amt numeric; v_on numeric; t_on numeric := 0; v_alloc numeric[];
        t_net numeric := 0; t_vat numeric := 0; t_tx numeric := 0; v_vt numeric; t_disc numeric := 0; t_ex numeric := 0; t_wht numeric := 0; t_goods numeric := 0; t_serv numeric := 0;
        v_total numeric; v_rev jsonb := '[]'::jsonb; v_voucher uuid;
begin
  if p_type not in ('INV','CA') then raise exception 'ประเภทเอกสาร % ไม่รองรับ', p_type; end if;
  if p_lines is null or jsonb_array_length(p_lines) = 0 then raise exception 'ต้องมีรายการอย่างน้อย 1 บรรทัด'; end if;
  if v_mode not in ('exclusive','inclusive') then raise exception 'ราคาสินค้า % ไม่ถูกต้อง', v_mode; end if;
  if v_term not in ('credit','credit_nodate') then raise exception 'เงื่อนไขชำระ % ไม่ถูกต้อง', v_term; end if;
  if v_date is null then raise exception 'ต้องระบุวันที่'; end if;
  if nullif(h->>'contact','') is null then raise exception 'ต้องเลือกลูกค้า'; end if;
  if nullif(h->>'due_date','') is not null then v_cd := (h->>'due_date')::date - v_date; end if;   -- แก้วันครบกำหนดตรง ๆ = เครดิตเปลี่ยนตาม (FA)
  if v_cd < 0 then raise exception 'วันครบกำหนดต้องไม่ก่อนวันที่ของเอกสาร'; end if;

  if p_type = 'CA' then v_term := 'credit'; v_cd := 0; end if;   -- ขายสด ไม่มีเครดิต/ครบกำหนด
  if p_edit is null then
  insert into sales_docs(id, doc_type, doc_no, doc_date, contact_id, status, ref_doc_id)
  values (v_id, p_type, next_doc_no(p_type, v_date, true), v_date, (h->>'contact')::uuid,
          case p_type when 'CA' then 'pending_collect' else 'awaiting_payment' end, p_ref);
  else   -- แก้เอกสารเดิม (M23): คงเลขที่เอกสาร/ใบสำคัญเดิม คืนสต็อกเดิมแล้วตัดใหม่ตามรายการใหม่
    select * into v_old from sales_docs where id = p_edit for update;
    v_oldv := v_old.voucher_id;
    perform stock_return_for_doc(p_edit);
    delete from sales_doc_lines where doc_id = p_edit;
    update sales_docs set doc_date = v_date, contact_id = (h->>'contact')::uuid where id = p_edit;
  end if;

  v_alloc := sales_ontop_alloc(p_lines, v_mode, nullif(h->>'ontop_type',''), coalesce(nullif(h->>'ontop_value','')::numeric, 0));
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
    select * into c0 from purchase_line_calc(v_qty, v_price, v_dt, v_dv, coalesce(nullif(l->>'vat',''), '7'), v_mode);
    v_on := coalesce(v_alloc[n], nullif(l->>'ontop','')::numeric, 0);   -- ส่วนลด On Top ที่ปันมาบรรทัดนี้
    if v_on < 0 then raise exception 'ส่วนลด On Top ต้องไม่ติดลบ (บรรทัด %)', n; end if;
    if v_on > 0 then select * into c from purchase_line_calc(v_qty, v_price, 'amount', c0.v_disc + v_on, coalesce(nullif(l->>'vat',''), '7'), v_mode);
    else c := c0; end if;
    t_on := t_on + v_on;
    v_wht := round(c.v_net * v_wr / 100, 2);
    v_amt := case when v_mode = 'exclusive' or c.v_exempt or c.v_rate = 0 then c.v_net else c.v_net + c.v_vat end;
    insert into sales_doc_lines(doc_id, line_no, description, detail, item_kind, qty, unit_price, amount, product_id, warehouse_id,
        unit, discount_type, discount_value, discount, vat_rate, vat_exempt, wht_rate, wht, src_line_no, ontop)
    values (v_id, n, v_desc, v_detail, case when pr.kind = 'service' then 'service' else 'goods' end, v_qty, v_price, v_amt, v_pid,
        coalesce(nullif(l->>'warehouse_id','')::uuid, v_wh),
        coalesce(nullif(l->>'unit',''), case when not v_auto then pr.base_unit end), v_dt, v_dv, c0.v_disc, c.v_rate, c.v_exempt, v_wr, v_wht, nullif(l->>'src_line_no','')::int, v_on);
    if pr.kind = 'service' then t_serv := t_serv + c.v_net; else t_goods := t_goods + c.v_net; end if;
    pr := null;
    t_net := t_net + c.v_net; t_vat := t_vat + c.v_vat; if not c.v_exempt and c.v_rate > 0 then t_tx := t_tx + c.v_net + case when v_mode = 'exclusive' then 0 else c.v_vat end; end if; t_disc := t_disc + c.v_disc; t_wht := t_wht + v_wht;
    if c.v_exempt then t_ex := t_ex + c.v_net; end if;
  end loop;
  -- M67: ภาษีขายคิดจากยอดรวมทั้งใบ (มูลค่าที่คำนวณภาษี 7% รวมทุกบรรทัด) แทนผลรวมภาษีรายบรรทัด
  v_vt := case when v_mode = 'exclusive' then round(t_tx * 7 / 100, 2) else round(t_tx * 7 / 107, 2) end;
  if v_mode <> 'exclusive' then
    t_net := t_net + t_vat - v_vt;
    -- ราคารวม VAT: เศษสตางค์ที่ย้ายระหว่างภาษีกับรายได้ ลงบัญชีรายได้ที่ยอดมากกว่า (ใบสำคัญยังสมดุล)
    if t_goods >= t_serv then t_goods := t_goods + t_vat - v_vt; else t_serv := t_serv + t_vat - v_vt; end if;
  end if;
  t_vat := v_vt;
  v_total := t_net + t_vat;
  if v_total <= 0 then raise exception 'ยอดรวมต้องมากกว่า 0'; end if;   -- FA บันทึกยอด 0.00 ได้ แต่เราไม่ลงรายการบัญชีศูนย์บาท

  update sales_docs set price_mode = v_mode, vat_rate = 7,
      term_mode = v_term, credit_days = v_cd, due_date = case when p_type = 'INV' and v_term = 'credit' then v_date + v_cd end,
      salesperson = nullif(h->>'salesperson',''), project = nullif(h->>'project',''), ref_no = nullif(h->>'ref_no',''),
      description = nullif(h->>'description',''), warehouse_id = v_wh,
      show_signature = coalesce((h->>'show_signature')::boolean, true), note = nullif(h->>'note',''),
      internal_note = nullif(h->>'internal_note',''),
      subtotal = t_net, vat = t_vat, total = v_total, discount_total = t_disc, exempt_base = t_ex, wht_total = t_wht,
      ontop_type = case when t_on > 0 then coalesce(nullif(h->>'ontop_type',''), 'amount') end,
      ontop_value = case when t_on = 0 then 0 when nullif(h->>'ontop_type','') is null then t_on else coalesce(nullif(h->>'ontop_value','')::numeric, 0) end,
      ontop_total = t_on
    where id = v_id;

  if t_goods > 0 then v_rev := v_rev || jsonb_build_object('account','41110','credit',t_goods); end if;
  if t_serv  > 0 then v_rev := v_rev || jsonb_build_object('account','41210','credit',t_serv);  end if;
  if t_vat   > 0 then v_rev := v_rev || jsonb_build_object('account','27111','credit',t_vat);   end if;
  if p_edit is null then
    v_voucher := post_voucher(case p_type when 'CA' then 'RV' else 'SV' end, v_date, null, p_type, v_id::text,
      jsonb_build_array(jsonb_build_object('account', case p_type when 'CA' then '11319' else '11311' end, 'debit', v_total)) || v_rev);
    update sales_docs set voucher_id = v_voucher where id = v_id;
  else
    perform overwrite_voucher(v_oldv, v_date,
      jsonb_build_array(jsonb_build_object('account', case p_type when 'CA' then '11319' else '11311' end, 'debit', v_total)) || v_rev);
  end if;
  perform stock_issue_for_doc(v_id);
  if p_edit is not null and v_old.ref_doc_id is not null then perform quotation_refresh(v_old.ref_doc_id); end if;
  return v_id;
end $$;
