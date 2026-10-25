-- M25.6 แบ่งจ่ายใบรับสินค้าจากใบสั่งซื้อ · ตามการทดสอบบน FlowAccount (25-10-2026)
-- ผลทดสอบ FA: (1) PO ที่อนุมัติแล้วเลือก "แบ่งจ่ายใบรับสินค้า" → ระบุเปอร์เซ็นต์/จำนวนเงิน → ได้ RI ใบละส่วน
-- (2) PO เป็น "แบ่งจ่าย" (แสดงยอดเรียกเก็บแล้ว) จนครบ 100% จึงเป็น "ดำเนินการแล้ว"
-- (3) ติ๊ก "รับเข้าสต็อกในครั้งนี้" ได้ครั้งเดียว · ถ้าไม่ติ๊ก สต็อกเข้าเองเมื่อออกใบสุดท้าย (ครบ 100%)
-- (4) เกิน 100% ได้หลังเตือน · (5) รีเซ็ตแบ่งจ่าย → รออนุมัติ โดย RI ที่ออกแล้วไม่ถูกแตะ (เตือนว่าอาจเปิดบิล/รับสต็อกซ้ำ)
-- ข้อจำกัด: ช่วงที่รับสต็อกก่อนครบ 100% มูลค่าสต็อก (ต้นทุนเต็ม) สูงกว่ายอดบัญชีสินค้าคงเหลือชั่วคราว จนกว่าจะออกครบ
-- ยังไม่ทดสอบ: แบ่งตามจำนวนสินค้า

alter table purchase_orders drop constraint purchase_orders_status_check;
alter table purchase_orders add constraint purchase_orders_status_check
  check (status in ('pending','approved','rejected','converted','cancelled','partial'));

alter table goods_receipts
  add column split_mode text check (split_mode in ('percent','amount')),
  add column split_value numeric(18,2),
  add column stock_in_done boolean not null default true;

create or replace function reset_purchase_order(p_id uuid) returns void language plpgsql as $$
declare po purchase_orders;
begin
  select * into po from purchase_orders where id = p_id for update;
  if not found then raise exception 'ไม่พบใบสั่งซื้อ'; end if;
  if po.status not in ('approved','rejected','converted','partial') then raise exception 'รีเซ็ตได้เฉพาะใบสั่งซื้อที่อนุมัติ ไม่อนุมัติ แบ่งจ่าย หรือดำเนินการแล้ว'; end if;
  update purchase_orders set status = 'pending' where id = p_id;
end $$;

-- ยอดที่เรียกเก็บแล้วของ PO (รวม RI แบ่งจ่ายที่ไม่ยกเลิก)
create function po_billed(p_id uuid) returns numeric language sql stable as $$
  select coalesce(sum(total), 0) from goods_receipts where po_id = p_id and split_mode is not null and status <> 'cancelled'
$$;

-- ออก RI แบ่งจ่าย: p_mode 'percent' (p_value = %) หรือ 'amount' (p_value = บาท รวม VAT)
create function split_ri_from_po(p_po uuid, p_date date, p_mode text, p_value numeric, p_receive_stock boolean default false) returns uuid
language plpgsql as $$
declare po purchase_orders; l purchase_order_lines; v_id uuid := gen_random_uuid(); v_no text; v uuid; f numeric; target numeric;
        t_net numeric := 0; t_vat numeric := 0; n_net numeric; n_vat numeric; n int := 0; cnt int; v_lines jsonb; resid numeric;
        v_billed numeric; v_stock boolean; v_has_stock boolean;
begin
  select * into po from purchase_orders where id = p_po for update;
  if not found or po.status not in ('pending','approved','partial') then raise exception 'แบ่งจ่ายได้เฉพาะใบสั่งซื้อที่รออนุมัติ อนุมัติแล้ว หรือแบ่งจ่ายอยู่'; end if;
  if p_mode not in ('percent','amount') then raise exception 'โหมดแบ่งจ่าย % ไม่ถูกต้อง', p_mode; end if;
  if p_value is null or p_value <= 0 then raise exception 'ต้องระบุค่าแบ่งจ่ายมากกว่า 0'; end if;
  if po.total <= 0 then raise exception 'ใบสั่งซื้อไม่มียอด'; end if;
  target := case when p_mode = 'percent' then round(po.total * p_value / 100, 2) else p_value end;
  f := target / po.total;
  select count(*) into cnt from purchase_order_lines where po_id = p_po;
  v_no := next_doc_no('RI', p_date, true);
  insert into goods_receipts(id, ri_no, ri_date, contact_id) values (v_id, v_no, p_date, po.contact_id);
  for l in select * from purchase_order_lines where po_id = p_po order by line_no loop
    n := n + 1;
    n_net := round(l.net * f, 2); n_vat := round(l.vat * f, 2);
    if n = cnt then  -- เศษปัดตกบรรทัดสุดท้าย ให้ยอดรวมเท่ากับเป้าหมายพอดี
      resid := target - (t_net + t_vat + n_net + n_vat);
      n_net := n_net + resid;
    end if;
    insert into goods_receipt_lines(ri_id, line_no, product_id, warehouse_id, qty, unit_price, vat_rate, net, vat, description, unit, vat_exempt)
    values (v_id, n, l.product_id, coalesce(l.warehouse_id, po.warehouse_id, main_warehouse()), l.qty, l.unit_price, l.vat_rate, n_net, n_vat,
            l.description, l.unit, l.vat_exempt);
    t_net := t_net + n_net; t_vat := t_vat + n_vat;
  end loop;
  v_lines := jsonb_build_array(jsonb_build_object('account', sys_account('inventory'), 'debit', t_net));
  if t_vat > 0 then v_lines := v_lines || jsonb_build_object('account','17113','debit',t_vat); end if;
  v_lines := v_lines || jsonb_build_object('account','21311','credit', t_net + t_vat);
  v := post_voucher('UV', p_date, null, 'RI', v_id::text, v_lines);
  update goods_receipts set subtotal = t_net, vat = t_vat, total = t_net + t_vat, uv_voucher_id = v, po_id = p_po, ref_no = po.po_no,
      credit_days = po.credit_days, due_date = coalesce(po.due_date, p_date), purchaser = po.purchaser, project = po.project,
      description = po.description, price_mode = po.price_mode, warehouse_id = po.warehouse_id, note = po.note,
      split_mode = p_mode, split_value = p_value, stock_in_done = false
    where id = v_id;

  -- สต็อก: รับครั้งเดียว (ติ๊กเอง หรืออัตโนมัติเมื่อครบ 100%)
  v_billed := po_billed(p_po);
  select exists(select 1 from goods_receipts where po_id = p_po and status <> 'cancelled' and stock_in_done) into v_has_stock;
  if p_receive_stock and v_has_stock then raise exception 'รับเข้าสต็อกไปแล้ว (รับได้ครั้งเดียว)'; end if;
  v_stock := not v_has_stock and (p_receive_stock or v_billed >= po.total);
  if v_stock then
    perform stock_in(l2.product_id, g.warehouse_id, l2.qty, l2.net, p_date, 'RI', v_id, v_no)
      from purchase_order_lines l2 join goods_receipt_lines g on g.ri_id = v_id and g.line_no = l2.line_no
      where l2.po_id = p_po order by l2.line_no;
    update goods_receipts set stock_in_done = true where id = v_id;
  end if;
  update purchase_orders set status = case when v_billed >= po.total then 'converted' else 'partial' end where id = p_po;
  return v_id;
end $$;
