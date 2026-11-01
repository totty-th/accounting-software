-- ใบเตรียมจ่าย: ปรับสถานะตามต้นแบบ (REA 01-11-2026)
--  รอดำเนินการ → ชำระเงิน | ยกเลิก | ลบ
--  ชำระเงินแล้ว → รับใบเสร็จแล้ว | แก้ไขข้อมูลการชำระ | รีเซ็ต
--  รีเซ็ต = กลับรายการจ่ายของทุกเอกสารในใบ แล้วกลับเป็นรอดำเนินการ
-- ยกเลิกใบที่จ่ายแล้วโดยตรง: ยังไม่ทดสอบบนต้นแบบ → คงเดิม (ต้องรีเซ็ตก่อน)
alter table payment_slips add column receipt_received boolean not null default false;
alter table payment_slips add column note text;
alter table payment_slips add column internal_note text;

create function receive_payment_slip(p_id uuid) returns void language plpgsql as $$
declare it record; n int := 0;
begin
  perform 1 from payment_slips where id = p_id and status = 'active' for update;
  if not found then raise exception 'ไม่พบใบเตรียมจ่ายหรือถูกยกเลิกแล้ว'; end if;
  for it in select * from payment_slip_items where slip_id = p_id loop
    n := n + 1;
    if not (select paid from slip_doc_info(it.doc_type, it.doc_id)) then raise exception 'รับใบเสร็จได้เมื่อจ่ายครบทุกเอกสารแล้ว'; end if;
  end loop;
  if n = 0 then raise exception 'ไม่มีเอกสารในใบเตรียมจ่าย'; end if;
  update payment_slips set receipt_received = true where id = p_id;
end $$;

create function reset_payment_slip(p_id uuid) returns void language plpgsql as $$
declare it record; v_any boolean := false;
begin
  perform 1 from payment_slips where id = p_id and status = 'active' for update;
  if not found then raise exception 'ไม่พบใบเตรียมจ่ายหรือถูกยกเลิกแล้ว'; end if;
  for it in select * from payment_slip_items where slip_id = p_id order by line_no loop
    if (select paid from slip_doc_info(it.doc_type, it.doc_id)) then
      v_any := true;
      if it.doc_type = 'EXP' then perform reset_expense(it.doc_id); else perform reset_goods_receipt(it.doc_id); end if;
    end if;
  end loop;
  if not v_any and not (select receipt_received from payment_slips where id = p_id) then
    raise exception 'ไม่มีรายการที่จ่ายแล้วให้รีเซ็ต';
  end if;
  update payment_slips set receipt_received = false where id = p_id;
end $$;

-- ลบได้เฉพาะใบที่ยังไม่มีการจ่าย (ใบเตรียมจ่ายไม่ลงบัญชีเอง จึงไม่มีรายการบัญชีให้กลับ)
create function delete_payment_slip(p_id uuid) returns void language plpgsql as $$
declare it record;
begin
  perform 1 from payment_slips where id = p_id for update;
  if not found then raise exception 'ไม่พบใบเตรียมจ่าย'; end if;
  for it in select * from payment_slip_items where slip_id = p_id loop
    if (select paid from slip_doc_info(it.doc_type, it.doc_id)) then raise exception 'ลบไม่ได้: มีเอกสารที่จ่ายแล้ว ให้รีเซ็ตก่อน'; end if;
  end loop;
  delete from payment_slip_items where slip_id = p_id;
  delete from payment_slips where id = p_id;
end $$;

create function update_payment_slip(p_id uuid, p_due date, p_preparer text, p_requester text, p_approver text, p_reason text,
  p_note text, p_internal text) returns void language plpgsql as $$
begin
  update payment_slips set due_date = p_due, preparer = nullif(p_preparer,''), requester = nullif(p_requester,''), approver = nullif(p_approver,''),
    reason = nullif(p_reason,''), note = nullif(p_note,''), internal_note = nullif(p_internal,'') where id = p_id and status = 'active';
  if not found then raise exception 'ไม่พบใบเตรียมจ่ายหรือถูกยกเลิกแล้ว'; end if;
end $$;

create or replace function cancel_payment_slip(p_id uuid) returns void language plpgsql as $$
declare it record;
begin
  perform 1 from payment_slips where id = p_id and status = 'active' for update;
  if not found then raise exception 'ไม่พบใบเตรียมจ่ายหรือถูกยกเลิกแล้ว'; end if;
  for it in select * from payment_slip_items where slip_id = p_id loop
    if (select paid from slip_doc_info(it.doc_type, it.doc_id)) then
      raise exception 'ยกเลิกไม่ได้: มีเอกสารที่จ่ายแล้ว ให้รีเซ็ตก่อน (ยังไม่ทดสอบการยกเลิกใบที่จ่ายแล้วบนต้นแบบ)';
    end if;
  end loop;
  update payment_slips set status = 'cancelled', receipt_received = false where id = p_id;
end $$;
