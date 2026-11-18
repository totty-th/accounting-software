-- M69.1 กฎรับสินค้าจาก PO (เจ้าของระบบตัดสินใจ 18-11-2026 "ข้อ 1 เอาที่แนะนำ · ข้อ 2 ตามที่แนะนำ" — ต่างจาก FA โดยตั้งใจ)
-- (1) PO หนึ่งใบมีใบรับสินค้าที่ยังมีผลซ้อนกันไม่ได้: แบบรับเต็มใบได้ใบเดียวและห้ามปนกับแบบแบ่งรับ
--     (เดิมรีเซ็ต PO แล้วสร้างซ้ำได้ → PO 100 แผ่น สต็อก 300 เจ้าหนี้ 3 เท่า) ต้องยกเลิก/ไม่อนุมัติใบเดิมก่อน
-- (2) แก้ RI ที่รับเต็มใบจาก PO: จำนวนเกิน PO ต้องยืนยัน (header.allow_over_po = true) ·
--     แก้ลดจากที่สั่ง (สินค้า/ราคา/ส่วนลดเท่า PO) → RI กลายเป็นแบบแบ่งรับตามจำนวน และ PO กลับเป็น "แบ่งจ่าย" รับส่วนที่เหลือต่อได้
--     ถ้าแก้ราคาด้วย คงเป็นรับเต็มใบ (ส่วนที่ขาดให้ออก RI ใหม่ที่ไม่อ้าง PO)
create function trg_ri_po_single_receipt() returns trigger language plpgsql as $$
declare v_no text;
begin
  if new.po_id is null or new.status in ('cancelled','rejected') then return new; end if;
  if tg_op = 'UPDATE' and old.po_id is not distinct from new.po_id and old.split_mode is not distinct from new.split_mode
     and old.status not in ('cancelled','rejected') then return new; end if;
  select ri_no into v_no from goods_receipts
   where po_id = new.po_id and id <> new.id and status not in ('cancelled','rejected')
     and (new.split_mode is null or split_mode is null)
   order by ri_no limit 1;
  if v_no is not null then
    raise exception 'ใบสั่งซื้อนี้มีใบรับสินค้า % ที่ยังมีผลอยู่ (รับซ้ำจะทำให้สต็อกและเจ้าหนี้เกิน) — ยกเลิกหรือไม่อนุมัติใบเดิมก่อน', v_no;
  end if;
  return new;
end $$;
alter function trg_ri_po_single_receipt() set search_path = public, pg_temp;
create trigger ri_po_single_receipt before update of po_id, split_mode, status on goods_receipts
  for each row execute function trg_ri_po_single_receipt();

alter function update_goods_receipt(uuid, jsonb, jsonb) rename to update_goods_receipt_core;

create function update_goods_receipt(p_id uuid, p_header jsonb, p_lines jsonb) returns uuid language plpgsql as $$
declare r goods_receipts; l jsonb; n int := 0; pol purchase_order_lines; v_full boolean; v_less boolean := false; v_ok boolean := true;
        g goods_receipt_lines; v_cnt int;
begin
  select * into r from goods_receipts where id = p_id;
  if not found then raise exception 'ไม่พบใบรับสินค้า'; end if;
  v_full := r.po_id is not null and r.split_mode is null and r.status in ('unpaid','approved')
            and not exists (select 1 from payment_slip_items i join payment_slips s on s.id = i.slip_id
                             where i.doc_type = 'RI' and i.doc_id = p_id and s.status = 'active')
            and p_lines is not null and jsonb_array_length(p_lines) > 0;
  if v_full and not coalesce((p_header->>'allow_over_po')::boolean, false) then
    for l in select * from jsonb_array_elements(p_lines) loop
      n := n + 1;
      select * into pol from purchase_order_lines where po_id = r.po_id and line_no = n;
      if found and pol.product_id = nullif(l->>'product_id','')::uuid and (l->>'qty')::numeric > pol.qty then
        raise exception 'OVER_PO: บรรทัดที่ % รับ % เกินจำนวนในใบสั่งซื้อ % — ยืนยันหากต้องการบันทึกรับเกิน',
          n, trim_scale((l->>'qty')::numeric), trim_scale(pol.qty);
      end if;
    end loop;
  end if;
  perform update_goods_receipt_core(p_id, p_header, p_lines);
  if v_full then
    -- บรรทัดตรงกับ PO ทุกบรรทัด (สินค้าเดียวกัน ไม่เกิน) และมีบรรทัดที่น้อยกว่าที่สั่ง → เปลี่ยนเป็นแบ่งรับตามจำนวน
    select count(*) into v_cnt from goods_receipt_lines where ri_id = p_id;
    if v_cnt <> (select count(*) from purchase_order_lines where po_id = r.po_id) then v_ok := false; end if;
    for g in select * from goods_receipt_lines where ri_id = p_id order by line_no loop
      select * into pol from purchase_order_lines where po_id = r.po_id and line_no = g.line_no;
      -- ราคา/ส่วนลดต้องเท่า PO ด้วย (ใบแบ่งรับล็อกราคาตาม PO — ถ้าผู้ขายแก้ราคาด้วย คงเป็นรับเต็มใบ)
      if not found or pol.product_id <> g.product_id or g.qty > pol.qty or g.unit_price <> pol.unit_price
         or g.discount_type is distinct from pol.discount_type or g.discount_value is distinct from pol.discount_value then v_ok := false; exit; end if;
      if g.qty < pol.qty then v_less := true; end if;
    end loop;
    if v_ok and v_less then
      update goods_receipts set split_mode = 'qty', split_value = null, stock_in_done = true where id = p_id;
      perform po_recompute_qty_status(r.po_id);
    end if;
  elsif r.po_id is not null and r.split_mode = 'qty' then
    perform po_recompute_qty_status(r.po_id);
  end if;
  return p_id;
end $$;
alter function update_goods_receipt(uuid, jsonb, jsonb) set search_path = public, pg_temp;
