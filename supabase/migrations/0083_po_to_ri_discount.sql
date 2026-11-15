-- M30.3 แปลง PO → RI เต็มจำนวน พร้อมส่วนลด/หัก ณ ที่จ่าย/ข้อมูลหัวเอกสาร (ทดสอบ FA 15-11-2026)
--  PO 4 ชิ้น × 100 ลด 10% VAT 7% = 385.20 → RI ได้ส่วนลด 10% ยอด 385.20 เลขอ้างอิง = เลข PO · แก้ส่วนลดใน RI ก่อนบันทึกได้ · ยอด PO ไม่ตามยอด RI
create or replace function upgrade_po_to_ri(p_id uuid, p_date date default null) returns uuid language plpgsql as $$
declare po purchase_orders; v_ri uuid; v_lines jsonb;
begin
  select * into po from purchase_orders where id = p_id for update;
  if not found or po.status not in ('pending','approved') then raise exception 'สร้างใบรับสินค้าได้เฉพาะใบสั่งซื้อที่รออนุมัติหรืออนุมัติแล้ว'; end if;
  select jsonb_agg(jsonb_build_object('product_id', product_id, 'warehouse_id', coalesce(warehouse_id, po.warehouse_id), 'description', description,
           'unit', unit, 'qty', qty, 'stock_qty', stock_qty, 'unit_price', unit_price, 'discount_type', discount_type, 'discount_value', discount_value,
           'vat', case when vat_exempt then 'exempt' else trim_scale(vat_rate)::text end, 'wht_rate', wht_rate) order by line_no)
    into v_lines from purchase_order_lines where po_id = p_id;
  v_ri := save_goods_receipt(jsonb_build_object('date', coalesce(p_date, po.po_date), 'contact', po.contact_id,
    'credit_days', po.credit_days, 'due_date', po.due_date, 'purchaser', po.purchaser, 'project', po.project, 'ref_no', po.po_no,
    'description', po.description, 'price_mode', po.price_mode, 'warehouse_id', po.warehouse_id, 'show_signature', po.show_signature,
    'note', po.note, 'internal_note', po.internal_note), v_lines);
  update goods_receipts set po_id = p_id where id = v_ri;
  update purchase_orders set status = 'converted', ri_id = v_ri where id = p_id;
  return v_ri;
end $$;
