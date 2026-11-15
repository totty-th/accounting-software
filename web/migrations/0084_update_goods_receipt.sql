create or replace function update_goods_receipt(p_id uuid, p_header jsonb, p_lines jsonb) returns uuid language plpgsql as $$
declare r goods_receipts; h jsonb := coalesce(p_header, '{}'); l jsonb; n int := 0; pr products; c record; v uuid;
        v_date date; v_mode text; v_cd int; v_dt text; v_dv numeric; v_wr numeric; v_wht numeric; wh uuid; v_qty numeric; v_price numeric; v_vat text;
        t_net numeric := 0; t_vat numeric := 0; t_disc numeric := 0; t_ex numeric := 0; t_wht numeric := 0; v_lines jsonb;
        old goods_receipt_lines; pol purchase_order_lines; v_other numeric; v_po_lines boolean;
begin
  select * into r from goods_receipts where id = p_id for update;
  if not found then raise exception 'ไม่พบใบรับสินค้า'; end if;
  if r.status not in ('unpaid','approved') then raise exception 'แก้ไขได้เฉพาะใบรับสินค้าที่รออนุมัติหรืออนุมัติแล้ว (จ่ายแล้ว/ไม่อนุมัติต้องรีเซ็ตก่อน)'; end if;
  if exists (select 1 from payment_slip_items i join payment_slips s on s.id = i.slip_id
              where i.doc_type = 'RI' and i.doc_id = p_id and s.status = 'active') then
    update goods_receipts set project = coalesce(h->>'project', project), ref_no = coalesce(h->>'ref_no', ref_no),
           description = coalesce(h->>'description', description), note = coalesce(h->>'note', note),
           internal_note = coalesce(h->>'internal_note', internal_note) where id = p_id;
    return p_id;
  end if;
  v_po_lines := r.po_id is not null;
  if v_po_lines and coalesce(r.split_mode, '') <> 'qty' then
    update goods_receipts set ri_date = coalesce(nullif(h->>'date','')::date, ri_date), purchaser = coalesce(h->>'purchaser', purchaser),
           project = coalesce(h->>'project', project), ref_no = coalesce(h->>'ref_no', ref_no),
           description = coalesce(h->>'description', description), note = coalesce(h->>'note', note),
           internal_note = coalesce(h->>'internal_note', internal_note) where id = p_id;
    if p_lines is not null and jsonb_array_length(p_lines) > 0 then
      raise exception 'แก้บรรทัดของใบรับสินค้าที่สร้างจาก PO แบบเต็มจำนวน/แบ่งตาม % หรือบาท ยังไม่รองรับ (ยังไม่ทดสอบ)', '%';
    end if;
    return p_id;
  end if;
  if p_lines is null or jsonb_array_length(p_lines) = 0 then raise exception 'ต้องมีรายการอย่างน้อย 1 บรรทัด'; end if;
  v_date := coalesce(nullif(h->>'date','')::date, r.ri_date);
  v_mode := coalesce(nullif(h->>'price_mode',''), r.price_mode, 'exclusive');
  v_cd := coalesce(nullif(h->>'credit_days','')::int, r.credit_days, 0);
  if v_po_lines and nullif(h->>'contact','') is not null and (h->>'contact')::uuid <> r.contact_id then
    raise exception 'ใบรับสินค้าที่แบ่งจาก PO เปลี่ยนผู้จำหน่ายไม่ได้';
  end if;
  perform ri_void_stock(p_id);
  perform reverse_voucher(r.uv_voucher_id);
  if v_po_lines then
    create temp table if not exists _ri_old on commit drop as select * from goods_receipt_lines where false;
    delete from _ri_old; insert into _ri_old select * from goods_receipt_lines where ri_id = p_id;
  end if;
  delete from goods_receipt_lines where ri_id = p_id;
  for l in select * from jsonb_array_elements(p_lines) loop
    n := n + 1;
    if v_po_lines then
      select * into old from _ri_old where line_no = (l->>'line_no')::int;
      if not found then raise exception 'ใบรับสินค้าที่แบ่งจาก PO เพิ่มบรรทัดใหม่ไม่ได้'; end if;
      select * into pol from purchase_order_lines where po_id = r.po_id and line_no = old.line_no;
      v_qty := (l->>'qty')::numeric;
      select po_line_billed_qty(r.po_id, old.line_no) into v_other;   -- บรรทัดของ RI นี้ถูกลบก่อนแล้ว จึงไม่รวมตัวเอง
      if v_qty <= 0 then raise exception 'จำนวนต้องมากกว่า 0'; end if;
      if v_other + v_qty > pol.qty then
        raise exception 'ไม่สามารถบันทึกได้ บรรทัดที่ % เหลือจำนวนที่แบ่งได้ % ชิ้น', old.line_no, trim_scale(pol.qty - v_other);
      end if;
      select * into pr from products where id = old.product_id;
      v_price := pol.unit_price; v_dt := pol.discount_type; v_dv := pol.discount_value; v_wr := pol.wht_rate; wh := old.warehouse_id;
      v_vat := case when pol.vat_exempt then 'exempt' else trim_scale(pol.vat_rate)::text end;
    else
      select * into pr from products where id = (l->>'product_id')::uuid;
      if not found or pr.kind <> 'goods_stock' then raise exception 'ใบรับสินค้ารับได้เฉพาะสินค้านับสต็อก'; end if;
      v_qty := (l->>'qty')::numeric; v_price := (l->>'unit_price')::numeric;
      v_dt := coalesce(nullif(l->>'discount_type',''), 'percent'); v_dv := coalesce(nullif(l->>'discount_value','')::numeric, 0);
      v_wr := coalesce(nullif(l->>'wht_rate','')::numeric, 0); v_vat := coalesce(l->>'vat','7');
      wh := coalesce(nullif(l->>'warehouse_id','')::uuid, nullif(h->>'warehouse_id','')::uuid, r.warehouse_id, main_warehouse());
    end if;
    select * into c from purchase_line_calc(v_qty, v_price, v_dt, v_dv, v_vat, v_mode);
    v_wht := round(c.v_net * v_wr / 100, 2);
    insert into goods_receipt_lines(ri_id, line_no, product_id, warehouse_id, qty, unit_price, vat_rate, net, vat,
        description, unit, discount_type, discount_value, discount, vat_exempt, wht_rate, wht, stock_qty)
    values (p_id, case when v_po_lines then old.line_no else n end, pr.id, wh, v_qty, v_price, c.v_rate, c.v_net, c.v_vat,
        nullif(l->>'description',''), coalesce(nullif(l->>'unit',''), pr.base_unit), v_dt, v_dv, c.v_disc, c.v_exempt, v_wr, v_wht,
        case when v_po_lines and old.stock_qty is not null then round(old.stock_qty * v_qty / old.qty, 4)
             else line_stock_qty(pr.id, coalesce(nullif(l->>'unit',''), pr.base_unit), l->>'stock_qty', n) end);
    t_net := t_net + c.v_net; t_vat := t_vat + c.v_vat; t_disc := t_disc + c.v_disc; t_wht := t_wht + v_wht;
    if c.v_exempt then t_ex := t_ex + c.v_net; end if;
  end loop;
  v_lines := jsonb_build_array(jsonb_build_object('account', sys_account('inventory'), 'debit', t_net));
  if t_vat > 0 then v_lines := v_lines || jsonb_build_object('account','17113','debit',t_vat); end if;
  v_lines := v_lines || jsonb_build_object('account','21311','credit', t_net + t_vat);
  v := post_voucher('UV', v_date, null, 'RI', p_id::text, v_lines);
  update goods_receipts set ri_date = v_date, subtotal = t_net, vat = t_vat, total = t_net + t_vat, uv_voucher_id = v,
      credit_days = v_cd, due_date = coalesce(nullif(h->>'due_date','')::date, v_date + v_cd),
      purchaser = coalesce(h->>'purchaser', purchaser), project = coalesce(h->>'project', project), ref_no = coalesce(h->>'ref_no', ref_no),
      description = coalesce(h->>'description', description), price_mode = v_mode, note = coalesce(h->>'note', note),
      internal_note = coalesce(h->>'internal_note', internal_note), discount_total = t_disc, exempt_base = t_ex, wht_total = t_wht,
      contact_id = case when v_po_lines then contact_id else coalesce(nullif(h->>'contact','')::uuid, contact_id) end
    where id = p_id;
  perform stock_in(g.product_id, g.warehouse_id, coalesce(g.stock_qty, g.qty), g.net, v_date, 'RI', p_id, r.ri_no)
     from goods_receipt_lines g where g.ri_id = p_id order by g.line_no;
  return p_id;
end $$;
