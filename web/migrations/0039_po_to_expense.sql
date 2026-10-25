alter table expenses add column po_id uuid references purchase_orders(id);
create index expenses_po_idx on expenses(po_id) where po_id is not null;
create or replace function reset_purchase_order(p_id uuid) returns void language plpgsql as $$
declare po purchase_orders;
begin
  select * into po from purchase_orders where id = p_id for update;
  if not found then raise exception 'ไม่พบใบสั่งซื้อ'; end if;
  if po.status not in ('approved','rejected','converted') then raise exception 'รีเซ็ตได้เฉพาะใบสั่งซื้อที่อนุมัติ ไม่อนุมัติ หรือดำเนินการแล้ว'; end if;
  update purchase_orders set status = 'pending' where id = p_id;
end $$;
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
