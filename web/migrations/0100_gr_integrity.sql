create or replace function ri_void_stock(p_id uuid) returns void language plpgsql as $$
declare m stock_movements; g record; v_min numeric; v_name text;
begin
  for g in select product_id, warehouse_id, sum(qty_in) q, min(move_date) d,
                  min(seq) filter (where move_date = (select min(move_date) from stock_movements s2
                     where s2.doc_id = p_id and s2.doc_type = 'RI' and s2.voided_at is null and s2.qty_in > 0
                       and s2.product_id = s.product_id and s2.warehouse_id = s.warehouse_id)) sq
             from stock_movements s where doc_id = p_id and doc_type = 'RI' and voided_at is null and qty_in > 0
            group by product_id, warehouse_id loop
    select min(bal) into v_min from (
      select move_date, seq, sum(qty_in - qty_out) over (order by move_date, seq) bal
        from stock_movements where product_id = g.product_id and warehouse_id = g.warehouse_id and voided_at is null) x
     where (move_date, seq) >= (g.d, g.sq);
    if coalesce(v_min, 0) - g.q < 0 then
      select name into v_name from products where id = g.product_id;
      raise exception 'ดำเนินการไม่ได้: สต็อกที่รับเข้ามาถูกใช้ไปแล้ว (% ถูกเบิก/ขายหลังวันที่รับ ถ้าถอนออกยอดคงเหลือย้อนหลังจะติดลบ)', v_name;
    end if;
    select min(bal) into v_min from (
      select move_date, seq, sum(qty_in - qty_out) over (order by move_date, seq) bal
        from stock_movements where product_id = g.product_id and voided_at is null) x
     where (move_date, seq) >= (g.d, g.sq);
    if coalesce(v_min, 0) - (select sum(qty_in) from stock_movements where doc_id = p_id and doc_type = 'RI' and voided_at is null and product_id = g.product_id) < 0 then
      select name into v_name from products where id = g.product_id;
      raise exception 'ดำเนินการไม่ได้: สต็อกที่รับเข้ามาถูกใช้ไปแล้ว (% ถูกเบิก/ขายหลังวันที่รับ ถ้าถอนออกยอดคงเหลือย้อนหลังจะติดลบ)', v_name;
    end if;
  end loop;
  for m in select * from stock_movements where doc_id = p_id and doc_type = 'RI' and voided_at is null and qty_in > 0 loop
    update product_stock set qty = qty - m.qty_in, value = value - m.value,
           last_avg = case when qty - m.qty_in > 0 then round((value - m.value) / (qty - m.qty_in), 4) else last_avg end
     where product_id = m.product_id;
    update stock_movements set voided_at = now() where id = m.id;
  end loop;
end $$;
alter function ri_void_stock(uuid) set search_path = public, pg_temp;
create or replace function purchase_line_calc(p_qty numeric, p_price numeric, p_dtype text, p_dval numeric, p_vat text, p_mode text,
  out v_disc numeric, out v_net numeric, out v_vat numeric, out v_rate numeric, out v_exempt boolean)
language plpgsql immutable as $$
declare v_gross numeric; v_after numeric;
begin
  if p_qty is null or p_qty <= 0 then raise exception 'จำนวนต้องมากกว่า 0'; end if;
  if p_price is null or p_price < 0 then raise exception 'ราคาต่อหน่วยต้องไม่ติดลบ'; end if;
  if coalesce(p_dval, 0) < 0 then raise exception 'ส่วนลดต้องไม่ติดลบ'; end if;
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
alter function purchase_line_calc(numeric, numeric, text, numeric, text, text) set search_path = public, pg_temp;
