-- M25.5 ใบสั่งซื้อ (PO) → ค่าใช้จ่าย (EXP) · ตามการทดสอบบน FlowAccount 25-10-2026
-- ผลทดสอบ FA: (1) สร้างค่าใช้จ่ายจาก PO ได้ทุกหมวด (ทดสอบ "การตลาดและโฆษณา") ต้องเลือกหมวดเองทุกบรรทัด
-- (2) เปิดฟอร์มแล้วปิดโดยไม่บันทึก = PO ไม่เปลี่ยน · บันทึกแล้ว PO = ดำเนินการแล้ว (เหลือแค่ปุ่ม "รีเซ็ต")
-- (3) รีเซ็ต PO ที่ดำเนินการแล้วได้ทันที → กลับ "รออนุมัติ" โดยเอกสารที่สร้างไว้ไม่ถูกแตะ และลิงก์ยังอยู่
-- (4) รีเซ็ตแล้วอนุมัติ/สร้างค่าใช้จ่ายใหม่ได้ → PO ผูกได้หลายใบ (ป๊อปอัปเอกสารที่เกี่ยวข้องแสดงทุกใบ)
-- (5) ยกเลิกค่าใช้จ่าย: PO ไม่เปลี่ยนสถานะ ต้องรีเซ็ตเอง · ลิงก์ค่าใช้จ่ายที่ยกเลิกยังแสดงในป๊อปอัป
-- ทดสอบแล้ว (M25.6): รีเซ็ต PO ที่แปลงเป็นใบรับสินค้า = logic เดียวกับค่าใช้จ่าย

alter table expenses add column po_id uuid references purchase_orders(id);
create index expenses_po_idx on expenses(po_id) where po_id is not null;

-- รีเซ็ต: อนุญาตใบที่ดำเนินการแล้วด้วย (กลับเป็นรออนุมัติ · ไม่แตะเอกสารที่สร้างไปแล้ว)
create or replace function reset_purchase_order(p_id uuid) returns void language plpgsql as $$
declare po purchase_orders;
begin
  select * into po from purchase_orders where id = p_id for update;
  if not found then raise exception 'ไม่พบใบสั่งซื้อ'; end if;
  if po.status not in ('approved','rejected','converted') then raise exception 'รีเซ็ตได้เฉพาะใบสั่งซื้อที่อนุมัติ ไม่อนุมัติ หรือดำเนินการแล้ว'; end if;
  update purchase_orders set status = 'pending' where id = p_id;
end $$;

-- บันทึกค่าใช้จ่ายจาก PO: ใช้ save_expense เดิม แล้วผูก po_id + เลขอ้างอิง และตั้ง PO เป็น "ดำเนินการแล้ว"
create function save_expense_from_po(p_po uuid, p_header jsonb, p_lines jsonb) returns uuid language plpgsql as $$
declare po purchase_orders; v_id uuid;
begin
  select * into po from purchase_orders where id = p_po for update;
  if not found or po.status not in ('pending','approved') then raise exception 'สร้างค่าใช้จ่ายได้เฉพาะใบสั่งซื้อที่รออนุมัติหรืออนุมัติแล้ว'; end if;
  v_id := save_expense(jsonb_set(coalesce(p_header, '{}'), '{ref_no}', to_jsonb(coalesce(nullif(p_header->>'ref_no',''), po.po_no))), p_lines);
  update expenses set po_id = p_po where id = v_id;
  update purchase_orders set status = 'converted' where id = p_po;
  return v_id;
end $$;
