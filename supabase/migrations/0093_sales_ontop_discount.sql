-- M62 ส่วนลด On Top ท้ายเอกสาร (เจ้าของระบบขอ 17-11-2026: ใบเสนอราคา · เลือก % หรือ บาท)
-- หักหลังส่วนลดรายบรรทัด ก่อน VAT · ปันลงทุกบรรทัดตามสัดส่วนมูลค่าหลังส่วนลดบรรทัด (เศษสตางค์ลงบรรทัดที่มูลค่ามากสุด) เพื่อให้ VAT/ยกเว้นภาษี/หัก ณ ที่จ่าย/รายได้ต่อบรรทัดถูกต้อง
-- sales_doc_lines.discount = ส่วนลดบรรทัดเท่านั้น · ontop = ส่วนที่ปันมา · amount = มูลค่าสุทธิหลังหักทั้งสองอย่าง (รายงานยอดขายตามสินค้าจึงสะท้อน On Top)
-- QT → ใบแจ้งหนี้/ขายสด/วางบิล: ส่วนลด On Top ตามไปตามสัดส่วนจำนวนที่เรียกเก็บ · ใบแจ้งหนี้/ขายสดในฟอร์มเดียวกันใช้ได้ด้วย
alter table sales_docs add column ontop_type text check (ontop_type in ('percent','amount')),
  add column ontop_value numeric(18,2) not null default 0 check (ontop_value >= 0),
  add column ontop_total numeric(18,2) not null default 0 check (ontop_total >= 0);
alter table sales_doc_lines add column ontop numeric(18,2) not null default 0 check (ontop >= 0);

-- ปันส่วนลด On Top: คืน array ต่อบรรทัด (ตามลำดับ p_lines) หรือ null เมื่อไม่มี
create function sales_ontop_alloc(p_lines jsonb, p_mode text, p_type text, p_value numeric) returns numeric[] language plpgsql immutable as $$
declare l jsonb; c record; b numeric[] := '{}'; s numeric := 0; t numeric; a numeric[] := '{}'; i int; big int := 1; rest numeric;
begin
  if p_type is null or coalesce(p_value, 0) = 0 then return null; end if;
  if p_type not in ('percent','amount') then raise exception 'ชนิดส่วนลด On Top % ไม่ถูกต้อง', p_type; end if;
  if p_value < 0 then raise exception 'ส่วนลด On Top ต้องไม่ติดลบ'; end if;
  if p_type = 'percent' and p_value > 100 then raise exception 'ส่วนลด On Top เกิน 100%%'; end if;
  for l in select * from jsonb_array_elements(p_lines) loop
    select * into c from purchase_line_calc(coalesce((l->>'qty')::numeric, 0), coalesce(nullif(l->>'unit_price','')::numeric, 0),
      coalesce(nullif(l->>'discount_type',''), 'percent'), coalesce(nullif(l->>'discount_value','')::numeric, 0), coalesce(nullif(l->>'vat',''), '7'), p_mode);
    b := b || (round(coalesce((l->>'qty')::numeric, 0) * coalesce(nullif(l->>'unit_price','')::numeric, 0), 2) - c.v_disc);
    s := s + b[array_length(b, 1)];
  end loop;
  if s <= 0 then raise exception 'ไม่มีมูลค่าให้หักส่วนลด On Top'; end if;
  t := case when p_type = 'percent' then round(s * p_value / 100, 2) else p_value end;
  if t > s then raise exception 'ส่วนลด On Top (%) เกินมูลค่าหลังส่วนลดรายการ (%)', t, s; end if;
  rest := t;
  for i in 1 .. array_length(b, 1) loop
    a := a || round(t * b[i] / s, 2); rest := rest - a[i];
    if b[i] > b[big] then big := i; end if;
  end loop;
  a[big] := a[big] + rest;
  return a;
end $$;

create or replace function save_quotation(p_id uuid, p_header jsonb, p_lines jsonb) returns uuid language plpgsql as $$
declare v_id uuid := p_id; h jsonb := coalesce(p_header, '{}'); l jsonb; n int := 0; q sales_docs; pr products;
        v_date date := (h->>'date')::date; v_mode text := coalesce(nullif(h->>'price_mode',''), 'exclusive');
        v_term text := coalesce(nullif(h->>'term_mode',''), 'credit');
        v_cd int := coalesce(nullif(h->>'credit_days','')::int, 0);
        v_dt text; v_dv numeric; v_wr numeric; v_wht numeric; v_qty numeric; v_price numeric; v_desc text; v_pid uuid; v_detail text; v_auto boolean;
        c record; c0 record; v_amt numeric; v_on numeric; t_on numeric := 0; v_alloc numeric[];
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
    t_net := t_net + c.v_net; t_vat := t_vat + c.v_vat; t_disc := t_disc + c.v_disc; t_wht := t_wht + v_wht;
    if c.v_exempt then t_ex := t_ex + c.v_net; end if;
  end loop;
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
        t_net numeric := 0; t_vat numeric := 0; t_disc numeric := 0; t_ex numeric := 0; t_wht numeric := 0; t_goods numeric := 0; t_serv numeric := 0;
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
    t_net := t_net + c.v_net; t_vat := t_vat + c.v_vat; t_disc := t_disc + c.v_disc; t_wht := t_wht + v_wht;
    if c.v_exempt then t_ex := t_ex + c.v_net; end if;
  end loop;
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

create or replace function quotation_bill(p_qt uuid, p_kind text, p_date date, p_mode text default 'all', p_value numeric default null,
                                          p_qtys jsonb default null) returns uuid language plpgsql as $$
declare q sales_docs; r record; v_lines jsonb := '[]'::jsonb; v_new numeric; v_ratio numeric; v_dv numeric; v_id uuid; v_hdr jsonb;
begin
  select * into q from sales_docs where id = p_qt and doc_type = 'QT' for update;
  if not found then raise exception 'ไม่พบใบเสนอราคา'; end if;
  if q.status not in ('pending_approval','approved','partial') then
    raise exception 'สร้างเอกสารต่อได้เฉพาะใบเสนอราคาที่รออนุมัติ อนุมัติแล้ว หรือแบ่งจ่าย';
  end if;
  if p_kind not in ('INV','CA','BL') then raise exception 'ชนิดเอกสาร % ไม่ถูกต้อง', p_kind; end if;

  if p_kind = 'BL' then   -- ใบวางบิลจาก QT: คัดลอกรายการทั้งใบ ไม่ลงบัญชี ไม่นับเป็นยอดเรียกเก็บ (ตาม FA: QT กลายเป็นดำเนินการแล้ว)
    if q.status = 'partial' then raise exception 'ใบเสนอราคาที่แบ่งจ่ายแล้วสร้างใบวางบิลไม่ได้'; end if;
    if exists (select 1 from sales_docs where ref_doc_id = p_qt and doc_type = 'BL' and status <> 'cancelled') then
      raise exception 'ใบเสนอราคานี้สร้างใบวางบิลแล้ว';
    end if;
    v_id := gen_random_uuid();
    insert into sales_docs(id, doc_type, doc_no, doc_date, contact_id, status, ref_doc_id, price_mode, vat_rate, subtotal, vat, total,
                           term_mode, credit_days, due_date, salesperson, project, ref_no, description, note, show_signature, discount_total, exempt_base,
                           ontop_type, ontop_value, ontop_total)
    values (v_id, 'BL', next_doc_no('BL', p_date, true), p_date, q.contact_id, 'billed', p_qt, q.price_mode, q.vat_rate, q.subtotal, q.vat, q.total,
            case when q.term_mode = 'cash' then 'credit' else q.term_mode end, case when q.term_mode = 'cash' then 0 else q.credit_days end,
            case when q.term_mode = 'credit' then p_date + q.credit_days end,
            q.salesperson, q.project, q.ref_no, q.description, q.note, q.show_signature, q.discount_total, q.exempt_base,
            q.ontop_type, q.ontop_value, q.ontop_total);
    insert into sales_doc_lines(doc_id, line_no, description, detail, item_kind, qty, unit_price, amount, product_id, warehouse_id, unit,
                                discount_type, discount_value, discount, vat_rate, vat_exempt, wht_rate, wht, src_line_no, ontop)
      select v_id, line_no, description, detail, item_kind, qty, unit_price, amount, product_id, warehouse_id, unit,
             discount_type, discount_value, discount, vat_rate, vat_exempt, wht_rate, wht, line_no, ontop from sales_doc_lines where doc_id = p_qt;
    perform quotation_refresh(p_qt);
    return v_id;
  end if;

  if p_mode not in ('all','percent','amount','qty') then raise exception 'วิธีแบ่ง % ไม่ถูกต้อง', p_mode; end if;
  if p_mode in ('percent','amount') then
    if p_value is null or p_value <= 0 then raise exception 'ระบุ%ที่ต้องการเรียกเก็บ', case p_mode when 'percent' then 'เปอร์เซ็นต์' else 'จำนวนเงิน' end; end if;
    v_ratio := case p_mode when 'percent' then p_value / 100 else p_value / nullif(q.total, 0) end;
    if v_ratio > 1 then raise exception '%เกินยอดใบเสนอราคา', case p_mode when 'percent' then 'เปอร์เซ็นต์' else 'จำนวนเงิน' end; end if;
  end if;
  if p_mode = 'qty' and p_qtys is null then raise exception 'ระบุจำนวนสินค้าที่ต้องการเรียกเก็บ'; end if;

  for r in select l.*, l.qty - coalesce((select sum(c.qty) from sales_doc_lines c join sales_docs d on d.id = c.doc_id
              where d.ref_doc_id = p_qt and d.doc_type in ('INV','CA') and d.status <> 'cancelled' and not d.is_deposit
                and c.src_line_no = l.line_no), 0) as rem
           from sales_doc_lines l where l.doc_id = p_qt order by l.line_no loop
    v_new := case p_mode when 'all' then r.rem
                         when 'qty' then coalesce(nullif(p_qtys->>(r.line_no::text), '')::numeric, 0)
                         else least(r.rem, round(r.qty * v_ratio, 4)) end;
    if v_new < 0 then raise exception 'จำนวนต้องไม่ติดลบ (บรรทัด %)', r.line_no; end if;
    if p_mode = 'qty' and v_new > r.rem then raise exception 'บรรทัด % เกินจำนวนคงเหลือ (เหลือ %)', r.line_no, trim_scale(r.rem); end if;
    if v_new <= 0 then continue; end if;
    v_dv := case when r.discount_type = 'amount' then round(r.discount_value * v_new / r.qty, 2) else r.discount_value end;   -- ส่วนลดเป็นบาท ปรับตามสัดส่วนจำนวน
    v_lines := v_lines || jsonb_build_object('product_id', r.product_id, 'description', r.description, 'detail', r.detail, 'unit', r.unit,
        'qty', v_new, 'unit_price', r.unit_price, 'discount_type', r.discount_type, 'discount_value', v_dv,
        'warehouse_id', coalesce(r.warehouse_id, q.warehouse_id),
        'vat', case when r.vat_exempt then 'exempt' else trim_scale(coalesce(r.vat_rate, 7))::text end, 'wht_rate', r.wht_rate, 'src_line_no', r.line_no,
        'ontop', case when r.ontop > 0 then round(r.ontop * v_new / r.qty, 2) else 0 end);   -- ส่วนลด On Top ตามสัดส่วนจำนวนที่เรียกเก็บ
  end loop;
  if jsonb_array_length(v_lines) = 0 then raise exception 'ไม่มีรายการที่จะเรียกเก็บ (ไม่เหลือจำนวน หรือยังไม่ได้ระบุจำนวน)'; end if;

  v_hdr := jsonb_build_object('date', p_date, 'contact', q.contact_id,
    'term_mode', case when q.term_mode = 'credit_nodate' then 'credit_nodate' else 'credit' end,
    'credit_days', case when q.term_mode = 'cash' then 0 else q.credit_days end,
    'salesperson', q.salesperson, 'project', q.project, 'ref_no', q.ref_no, 'description', q.description,
    'price_mode', q.price_mode, 'warehouse_id', q.warehouse_id, 'show_signature', q.show_signature, 'note', q.note,
    'internal_note', q.internal_note);
  v_id := create_invoice_full(v_hdr, v_lines, p_qt, p_kind);
  update sales_docs set delivery_mode = q.delivery_mode, ship_name = q.ship_name, ship_address = q.ship_address, ship_phone = q.ship_phone,
      carrier = q.carrier, delivery_note = q.delivery_note where id = v_id;   -- ข้อมูลจัดส่งตามไปกับเอกสาร
  perform quotation_refresh(p_qt);
  return v_id;
end $$;

create or replace function create_final_invoice(p_qt uuid, p_date date, p_kind text default 'INV') returns uuid language plpgsql as $$
declare q sales_docs; dep sales_docs; v_lines jsonb; v_id uuid;
begin
  if p_kind not in ('INV','CA','BL') then raise exception 'ชนิดเอกสาร % ไม่ถูกต้อง', p_kind; end if;
  select * into q from sales_docs where id = p_qt and doc_type = 'QT' for update;
  if not found or q.status <> 'deposit_paid' then raise exception 'ใบเสนอราคานี้ยังไม่มีมัดจำ'; end if;
  select * into dep from sales_docs where ref_doc_id = p_qt and is_deposit and status not in ('cancelled','invoice_opened')
   order by (doc_type = 'BL') limit 1;   -- ใช้ INV/CA ก่อน; BL เฉพาะที่ยังไม่แปลง
  if not found then raise exception 'ไม่พบเอกสารมัดจำที่ใช้งานอยู่'; end if;
  if p_kind = 'BL' then
    v_id := gen_random_uuid();
    insert into sales_docs(id, doc_type, doc_no, doc_date, contact_id, status, ref_doc_id, price_mode, vat_rate, subtotal, vat, total,
                           term_mode, credit_days, due_date, salesperson, project, ref_no, description, note, show_signature,
                           discount_total, exempt_base, deposit_net, deposit_vat, ontop_type, ontop_value, ontop_total)
    values (v_id, 'BL', next_doc_no('BL', p_date, true), p_date, q.contact_id, 'billed', p_qt, q.price_mode, q.vat_rate,
            q.subtotal, q.vat - dep.vat, q.total - dep.total,
            case when q.term_mode = 'cash' then 'credit' else q.term_mode end, case when q.term_mode = 'cash' then 0 else q.credit_days end,
            case when q.term_mode = 'credit' then p_date + q.credit_days end,
            q.salesperson, q.project, q.ref_no, q.description, q.note, q.show_signature, q.discount_total, q.exempt_base,
            dep.subtotal, dep.vat, q.ontop_type, q.ontop_value, q.ontop_total);
    insert into sales_doc_lines(doc_id, line_no, description, detail, item_kind, qty, unit_price, amount, product_id, warehouse_id, unit,
                                discount_type, discount_value, discount, vat_rate, vat_exempt, wht_rate, wht, src_line_no, ontop)
      select v_id, line_no, description, detail, item_kind, qty, unit_price, amount, product_id, warehouse_id, unit,
             discount_type, discount_value, discount, vat_rate, vat_exempt, wht_rate, wht, line_no, ontop from sales_doc_lines where doc_id = p_qt;
  else
    select jsonb_agg(jsonb_build_object('description',description,'kind',item_kind,'qty',qty,'unit_price',unit_price,'product_id',product_id,'warehouse_id',warehouse_id) order by line_no)
      into v_lines from sales_doc_lines where doc_id = p_qt;
    v_id := create_sales_doc(p_kind, p_date, q.contact_id, v_lines, q.price_mode, q.vat_rate, p_qt, null, dep.subtotal, dep.vat);
  end if;
  update sales_docs set status = 'converted' where id = p_qt;
  return v_id;
end $$;

create or replace function duplicate_quotation(p_id uuid, p_date date default null) returns uuid language plpgsql as $$
declare q sales_docs; v_lines jsonb;
begin
  select * into q from sales_docs where id = p_id and doc_type = 'QT';
  if not found then raise exception 'ไม่พบใบเสนอราคา'; end if;
  select jsonb_agg(jsonb_build_object('product_id', product_id, 'description', description, 'detail', detail, 'unit', unit, 'qty', qty,
           'unit_price', unit_price, 'discount_type', discount_type, 'discount_value', discount_value,
           'vat', case when vat_exempt then 'exempt' else trim_scale(coalesce(vat_rate, 7))::text end, 'wht_rate', wht_rate) order by line_no)
    into v_lines from sales_doc_lines where doc_id = p_id;
  return save_quotation(null, jsonb_build_object('date', coalesce(p_date, today_th()), 'contact', q.contact_id, 'term_mode', q.term_mode,
    'credit_days', q.credit_days, 'salesperson', q.salesperson, 'project', q.project, 'ref_no', q.ref_no, 'description', q.description,
    'price_mode', q.price_mode, 'warehouse_id', q.warehouse_id, 'show_signature', q.show_signature, 'note', q.note,
    'internal_note', q.internal_note, 'ontop_type', q.ontop_type, 'ontop_value', q.ontop_value), v_lines);
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
    'internal_note', q.internal_note, 'ontop_type', q.ontop_type, 'ontop_value', q.ontop_value), v_lines);
end $$;
