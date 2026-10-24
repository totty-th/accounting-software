-- M18.7 ใบรับสินค้า (RI) และค่าใช้จ่าย (EXP) เต็มรูปแบบ · ตาม REA FlowAccount 24-10-2026
-- หัวเอกสาร: เครดิต/ครบกำหนด, ผู้สั่งซื้อ, โปรเจกต์, เลขที่อ้างอิง, รายละเอียด, ราคารวม/ไม่รวมภาษี, (RI) คลัง, ลายเซ็น, หมายเหตุ, โน้ตภายใน
-- บรรทัด: รายละเอียดเพิ่ม, หน่วย, ส่วนลด % หรือ บาท, ภาษี 7%/0%/ยกเว้น, หัก ณ ที่จ่ายต่อบรรทัด
-- ยังไม่ทดสอบบน FA (จึงไม่ทำ): แก้ไข RI/EXP หลังบันทึก (ลงบัญชีแล้ว), หัก ณ ที่จ่ายของ RI ตอนจ่าย (เป็นข้อมูลบนเอกสาร), แนบไฟล์

alter table goods_receipts
  add column credit_days int not null default 0 check (credit_days >= 0), add column purchaser text, add column project text,
  add column description text, add column price_mode text not null default 'exclusive' check (price_mode in ('exclusive','inclusive')),
  add column warehouse_id uuid references warehouses(id), add column show_signature boolean not null default true,
  add column note text, add column internal_note text,
  add column discount_total numeric(18,2) not null default 0, add column exempt_base numeric(18,2) not null default 0,
  add column wht_total numeric(18,2) not null default 0;
alter table goods_receipt_lines
  add column description text, add column unit text,
  add column discount_type text not null default 'percent' check (discount_type in ('percent','amount')),
  add column discount_value numeric(18,2) not null default 0 check (discount_value >= 0),
  add column discount numeric(18,2) not null default 0, add column vat_exempt boolean not null default false,
  add column wht_rate numeric(5,2) not null default 0 check (wht_rate >= 0 and wht_rate <= 100), add column wht numeric(18,2) not null default 0;

alter table expenses
  add column credit_days int not null default 0 check (credit_days >= 0), add column purchaser text, add column project text,
  add column ref_no text, add column description text, add column show_signature boolean not null default true,
  add column note text, add column internal_note text,
  add column discount_total numeric(18,2) not null default 0, add column exempt_base numeric(18,2) not null default 0;
alter table expense_lines
  add column unit text,
  add column discount_type text not null default 'percent' check (discount_type in ('percent','amount')),
  add column discount_value numeric(18,2) not null default 0 check (discount_value >= 0),
  add column discount numeric(18,2) not null default 0, add column vat_exempt boolean not null default false;

-- คำนวณบรรทัดร่วม: คืน (discount, net, vat) จาก qty*price, ส่วนลด, ภาษี, โหมดราคา
create function purchase_line_calc(p_qty numeric, p_price numeric, p_dtype text, p_dval numeric, p_vat text, p_mode text,
  out v_disc numeric, out v_net numeric, out v_vat numeric, out v_rate numeric, out v_exempt boolean)
language plpgsql immutable as $$
declare v_gross numeric; v_after numeric;
begin
  v_exempt := coalesce(p_vat, '7') = 'exempt';
  v_rate := case when v_exempt then 0 else coalesce(nullif(p_vat,'')::numeric, 7) end;
  if v_rate not in (0, 7) then raise exception 'ภาษี % ไม่รองรับ (7%% / 0%% / ยกเว้น)', p_vat; end if;
  if p_dtype = 'percent' and p_dval > 100 then raise exception 'ส่วนลดเกิน 100%%'; end if;
  v_gross := round(p_qty * p_price, 2);
  v_disc := case when p_dtype = 'amount' then p_dval else round(v_gross * p_dval / 100, 2) end;
  if v_disc > v_gross then raise exception 'ส่วนลดเกินมูลค่ารายการ'; end if;
  v_after := v_gross - v_disc;
  if v_exempt or v_rate = 0 then v_net := v_after; v_vat := 0;
  elsif p_mode = 'exclusive' then v_net := v_after; v_vat := round(v_net * v_rate / 100, 2);
  else v_net := round(v_after * 100 / (100 + v_rate), 2); v_vat := v_after - v_net; end if;
end $$;

-- ใบรับสินค้าเต็มรูปแบบ: สร้าง + ลงบัญชี UV + รับสต็อก (เหมือน create_goods_receipt แต่มีส่วนลด/ภาษีต่อบรรทัด/หัวเอกสารครบ)
-- p_header: date, contact, credit_days, due_date, purchaser, project, ref_no, description, price_mode, warehouse_id, show_signature, note, internal_note
-- p_lines[]: product_id, description, unit, qty, unit_price, discount_type, discount_value, vat('7'|'0'|'exempt'), wht_rate, warehouse_id
create function save_goods_receipt(p_header jsonb, p_lines jsonb) returns uuid language plpgsql as $$
declare h jsonb := coalesce(p_header, '{}'); l jsonb; n int := 0; pr products; c record; v_id uuid := gen_random_uuid(); v_no text; v uuid;
        v_date date := (h->>'date')::date; v_mode text := coalesce(nullif(h->>'price_mode',''), 'exclusive');
        v_cd int := coalesce(nullif(h->>'credit_days','')::int, 0); v_dt text; v_dv numeric; v_wr numeric; v_wht numeric; wh uuid;
        t_net numeric := 0; t_vat numeric := 0; t_disc numeric := 0; t_ex numeric := 0; t_wht numeric := 0; v_lines jsonb;
begin
  if p_lines is null or jsonb_array_length(p_lines) = 0 then raise exception 'ต้องมีรายการอย่างน้อย 1 บรรทัด'; end if;
  if v_mode not in ('exclusive','inclusive') then raise exception 'ราคาสินค้า % ไม่ถูกต้อง', v_mode; end if;
  if v_date is null then raise exception 'ต้องระบุวันที่'; end if;
  if nullif(h->>'contact','') is null then raise exception 'ต้องเลือกผู้จำหน่าย'; end if;
  v_no := next_doc_no('RI', v_date, true);
  insert into goods_receipts(id, ri_no, ri_date, contact_id) values (v_id, v_no, v_date, (h->>'contact')::uuid);
  for l in select * from jsonb_array_elements(p_lines) loop
    n := n + 1;
    select * into pr from products where id = (l->>'product_id')::uuid;
    if not found or pr.kind <> 'goods_stock' then raise exception 'ใบรับสินค้ารับได้เฉพาะสินค้านับสต็อก'; end if;
    v_dt := coalesce(nullif(l->>'discount_type',''), 'percent'); v_dv := coalesce(nullif(l->>'discount_value','')::numeric, 0);
    v_wr := coalesce(nullif(l->>'wht_rate','')::numeric, 0);
    select * into c from purchase_line_calc((l->>'qty')::numeric, (l->>'unit_price')::numeric, v_dt, v_dv, coalesce(l->>'vat','7'), v_mode);
    v_wht := round(c.v_net * v_wr / 100, 2);
    wh := coalesce(nullif(l->>'warehouse_id','')::uuid, nullif(h->>'warehouse_id','')::uuid, main_warehouse());
    insert into goods_receipt_lines(ri_id, line_no, product_id, warehouse_id, qty, unit_price, vat_rate, net, vat,
        description, unit, discount_type, discount_value, discount, vat_exempt, wht_rate, wht)
    values (v_id, n, pr.id, wh, (l->>'qty')::numeric, (l->>'unit_price')::numeric, c.v_rate, c.v_net, c.v_vat,
        nullif(l->>'description',''), coalesce(nullif(l->>'unit',''), pr.base_unit), v_dt, v_dv, c.v_disc, c.v_exempt, v_wr, v_wht);
    t_net := t_net + c.v_net; t_vat := t_vat + c.v_vat; t_disc := t_disc + c.v_disc; t_wht := t_wht + v_wht;
    if c.v_exempt then t_ex := t_ex + c.v_net; end if;
  end loop;
  v_lines := jsonb_build_array(jsonb_build_object('account', sys_account('inventory'), 'debit', t_net));
  if t_vat > 0 then v_lines := v_lines || jsonb_build_object('account','17113','debit',t_vat); end if;
  v_lines := v_lines || jsonb_build_object('account','21311','credit', t_net + t_vat);
  v := post_voucher('UV', v_date, null, 'RI', v_id::text, v_lines);
  update goods_receipts set subtotal = t_net, vat = t_vat, total = t_net + t_vat, uv_voucher_id = v,
      credit_days = v_cd, due_date = coalesce(nullif(h->>'due_date','')::date, v_date + v_cd), purchaser = nullif(h->>'purchaser',''),
      project = nullif(h->>'project',''), ref_no = nullif(h->>'ref_no',''), description = nullif(h->>'description',''),
      price_mode = v_mode, warehouse_id = nullif(h->>'warehouse_id','')::uuid,
      show_signature = coalesce((h->>'show_signature')::boolean, true), note = nullif(h->>'note',''), internal_note = nullif(h->>'internal_note',''),
      discount_total = t_disc, exempt_base = t_ex, wht_total = t_wht
    where id = v_id;
  perform stock_in(g.product_id, g.warehouse_id, g.qty, g.net, v_date, 'RI', v_id, v_no)
     from goods_receipt_lines g where g.ri_id = v_id order by g.line_no;
  return v_id;
end $$;

-- ค่าใช้จ่ายเต็มรูปแบบ → UV ทันที
-- p_lines[]: description, category, account, unit, qty, unit_price, discount_type, discount_value, vat('7'|'0'|'exempt'), wht_rate
create function save_expense(p_header jsonb, p_lines jsonb) returns uuid language plpgsql as $$
declare h jsonb := coalesce(p_header, '{}'); l jsonb; n int := 0; c record; v_id uuid := gen_random_uuid(); v uuid;
        v_date date := (h->>'date')::date; v_mode text := coalesce(nullif(h->>'price_mode',''), 'exclusive');
        v_cd int := coalesce(nullif(h->>'credit_days','')::int, 0); v_dt text; v_dv numeric; v_wr numeric; v_wht numeric;
        t_net numeric := 0; t_vat numeric := 0; t_disc numeric := 0; t_ex numeric := 0; t_wht numeric := 0; v_lines jsonb := '[]'::jsonb;
begin
  if p_lines is null or jsonb_array_length(p_lines) = 0 then raise exception 'ต้องมีรายการอย่างน้อย 1 บรรทัด'; end if;
  if v_mode not in ('exclusive','inclusive') then raise exception 'ราคาสินค้า % ไม่ถูกต้อง', v_mode; end if;
  if v_date is null then raise exception 'ต้องระบุวันที่'; end if;
  if nullif(h->>'contact','') is null then raise exception 'ต้องเลือกผู้จำหน่าย'; end if;
  insert into expenses(id, exp_no, exp_date, contact_id, price_mode) values (v_id, next_doc_no('EXP', v_date, true), v_date, (h->>'contact')::uuid, v_mode);
  for l in select * from jsonb_array_elements(p_lines) loop
    n := n + 1;
    if nullif(l->>'account','') is null then raise exception 'บรรทัด % ต้องเลือกหมวดค่าใช้จ่าย', n; end if;
    if coalesce(nullif(l->>'description',''), '') = '' then raise exception 'บรรทัด % ต้องระบุรายละเอียด', n; end if;
    v_dt := coalesce(nullif(l->>'discount_type',''), 'percent'); v_dv := coalesce(nullif(l->>'discount_value','')::numeric, 0);
    v_wr := coalesce(nullif(l->>'wht_rate','')::numeric, 0);
    select * into c from purchase_line_calc((l->>'qty')::numeric, (l->>'unit_price')::numeric, v_dt, v_dv, coalesce(l->>'vat','7'), v_mode);
    v_wht := round(c.v_net * v_wr / 100, 2);
    insert into expense_lines(expense_id, line_no, description, category, account_code, qty, unit_price, vat_rate, wht_rate, net, vat, wht,
        unit, discount_type, discount_value, discount, vat_exempt)
    values (v_id, n, l->>'description', nullif(l->>'category',''), l->>'account', (l->>'qty')::numeric, (l->>'unit_price')::numeric,
        c.v_rate, v_wr, c.v_net, c.v_vat, v_wht, nullif(l->>'unit',''), v_dt, v_dv, c.v_disc, c.v_exempt);
    t_net := t_net + c.v_net; t_vat := t_vat + c.v_vat; t_disc := t_disc + c.v_disc; t_wht := t_wht + v_wht;
    if c.v_exempt then t_ex := t_ex + c.v_net; end if;
    v_lines := v_lines || jsonb_build_object('account', l->>'account', 'debit', c.v_net);
  end loop;
  if t_vat > 0 then v_lines := v_lines || jsonb_build_object('account','17113','debit',t_vat); end if;
  v_lines := v_lines || jsonb_build_object('account','21399','credit', t_net + t_vat);
  v := post_voucher('UV', v_date, null, 'EXP', v_id::text, v_lines);
  update expenses set subtotal = t_net, vat = t_vat, total = t_net + t_vat, wht_total = t_wht, uv_voucher_id = v,
      credit_days = v_cd, due_date = coalesce(nullif(h->>'due_date','')::date, v_date + v_cd), purchaser = nullif(h->>'purchaser',''),
      project = nullif(h->>'project',''), ref_no = nullif(h->>'ref_no',''), description = nullif(h->>'description',''),
      show_signature = coalesce((h->>'show_signature')::boolean, true), note = nullif(h->>'note',''), internal_note = nullif(h->>'internal_note',''),
      discount_total = t_disc, exempt_base = t_ex
    where id = v_id;
  return v_id;
end $$;
