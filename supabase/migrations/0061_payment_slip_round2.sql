-- ใบเตรียมจ่าย รอบ 2 (REA 01-11-2026)
--  • ยกเลิกใบที่จ่ายแล้ว = กลับรายการจ่ายของทุกเอกสาร (PV-R) แล้วยกเลิกใบ · เอกสารยังถูกล็อกกับใบที่ยกเลิก
--  • ลบได้เฉพาะใบรอดำเนินการที่เป็นเลขล่าสุด (กันเลขขาด) · ใบที่ยกเลิก/จ่ายแล้วลบไม่ได้
--  • เพิ่ม/ลบเอกสารในใบหลังบันทึก (เฉพาะรอดำเนินการ ผู้จำหน่ายเดียวกัน) · แก้เลขที่เอกสาร · ประวัติเอกสาร
-- ยังไม่ทดสอบบนต้นแบบ: ลบแถวด้วยไอคอนถังขยะ, ลบใบที่ไม่ใช่เลขล่าสุด (ใช้กฎตามข้อความของต้นแบบ)
create table payment_slip_events (
  id bigserial primary key, slip_id uuid not null references payment_slips(id),
  at timestamptz not null default now(), text text not null
);
create function slip_log(p_slip uuid, p_text text) returns void language sql as $$
  insert into payment_slip_events(slip_id, text) values (p_slip, p_text) $$;

create function trg_slip_created() returns trigger language plpgsql as $$
begin perform slip_log(new.id, 'สร้างเอกสาร ' || new.pay_no); return new; end $$;
create trigger payment_slips_created after insert on payment_slips for each row execute function trg_slip_created();

-- บันทึกการชำระเงินของเอกสารในใบ (ทั้งเอกสารจ่ายและรีเซ็ต)
create function trg_slip_doc_status() returns trigger language plpgsql as $$
declare v_type text := case tg_table_name when 'expenses' then 'EXP' else 'RI' end; v_no text; s record;
begin
  if new.status = old.status or (new.status <> 'paid' and old.status <> 'paid') then return new; end if;
  select x.slip_id into s from payment_slip_items x join payment_slips p on p.id = x.slip_id
   where x.doc_type = v_type and x.doc_id = new.id and p.status = 'active' limit 1;
  if not found then return new; end if;
  v_no := (select doc_no from slip_doc_info(v_type, new.id));
  perform slip_log(s.slip_id, case when new.status = 'paid' then 'บันทึกการชำระเงิน ' else 'กลับรายการชำระเงิน ' end || v_no);
  return new;
end $$;
create trigger expenses_slip_status after update of status on expenses for each row execute function trg_slip_doc_status();
create trigger goods_receipts_slip_status after update of status on goods_receipts for each row execute function trg_slip_doc_status();

-- เอกสารถูกล็อกกับทุกใบที่ยังไม่ถูกลบ รวมใบที่ยกเลิก (ต้นแบบไม่ปล่อยเอกสารคืนหลังยกเลิกใบ)
create or replace function create_payment_slip(p_date date, p_due date, p_docs jsonb, p_preparer text default null,
  p_requester text default null, p_approver text default null, p_reason text default null) returns uuid
language plpgsql as $$
declare v_id uuid := gen_random_uuid(); d jsonb; n int := 0; i record;
begin
  if p_docs is null or jsonb_array_length(p_docs) = 0 then raise exception 'ต้องเลือกเอกสารอย่างน้อย 1 รายการ'; end if;
  insert into payment_slips(id, pay_no, pay_date, due_date, preparer, requester, approver, reason)
  values (v_id, next_doc_no('PAY', p_date, true), p_date, p_due, p_preparer, p_requester, p_approver, p_reason);
  for d in select * from jsonb_array_elements(p_docs) loop
    select * into i from slip_doc_info(d->>'type', (d->>'id')::uuid);
    if not found then raise exception 'ไม่พบเอกสารที่เลือก'; end if;
    if not i.payable then raise exception 'เอกสาร % จ่ายไม่ได้ (ต้องรออนุมัติหรืออนุมัติแล้ว และยังไม่จ่าย)', i.doc_no; end if;
    if exists (select 1 from payment_slip_items x where x.doc_type = d->>'type' and x.doc_id = (d->>'id')::uuid) then
      raise exception 'เอกสาร % อยู่ในใบเตรียมจ่ายอื่นแล้ว', i.doc_no;
    end if;
    n := n + 1;
    insert into payment_slip_items values (v_id, n, d->>'type', (d->>'id')::uuid);
  end loop;
  return v_id;
end $$;

create or replace function cancel_payment_slip(p_id uuid) returns void language plpgsql as $$
declare it record;
begin
  perform 1 from payment_slips where id = p_id and status = 'active' for update;
  if not found then raise exception 'ไม่พบใบเตรียมจ่ายหรือถูกยกเลิกแล้ว'; end if;
  for it in select * from payment_slip_items where slip_id = p_id order by line_no loop
    if (select paid from slip_doc_info(it.doc_type, it.doc_id)) then
      if it.doc_type = 'EXP' then perform reset_expense(it.doc_id); else perform reset_goods_receipt(it.doc_id); end if;
    end if;
  end loop;
  update payment_slips set status = 'cancelled', receipt_received = false where id = p_id;
  perform slip_log(p_id, 'ยกเลิกเอกสาร');
end $$;

create or replace function delete_payment_slip(p_id uuid) returns void language plpgsql as $$
declare s payment_slips; it record;
begin
  select * into s from payment_slips where id = p_id for update;
  if not found then raise exception 'ไม่พบใบเตรียมจ่าย'; end if;
  if s.status = 'cancelled' then
    raise exception 'ไม่สามารถลบเอกสารได้ เนื่องจากจะทำให้เลขที่เอกสารไม่ต่อเนื่อง หรือเอกสารมีการเปลี่ยนแปลงสถานะแล้ว'; end if;
  for it in select * from payment_slip_items where slip_id = p_id loop
    if (select paid from slip_doc_info(it.doc_type, it.doc_id)) then
      raise exception 'ไม่สามารถลบเอกสารได้ เนื่องจากจะทำให้เลขที่เอกสารไม่ต่อเนื่อง หรือเอกสารมีการเปลี่ยนแปลงสถานะแล้ว'; end if;
  end loop;
  if exists (select 1 from payment_slips where pay_no > s.pay_no) then
    raise exception 'ไม่สามารถลบเอกสารได้ เนื่องจากจะทำให้เลขที่เอกสารไม่ต่อเนื่อง หรือเอกสารมีการเปลี่ยนแปลงสถานะแล้ว'; end if;
  delete from payment_slip_events where slip_id = p_id;
  delete from payment_slip_items where slip_id = p_id;
  delete from payment_slips where id = p_id;
end $$;

-- เพิ่มเอกสาร: เฉพาะใบรอดำเนินการ (ยังไม่มีเอกสารจ่าย) · ผู้จำหน่ายต้องเป็นรายเดียวกับใบ
create function add_slip_doc(p_slip uuid, p_type text, p_doc uuid) returns void language plpgsql as $$
declare s payment_slips; it record; i record; v_contact uuid; v_n int;
begin
  select * into s from payment_slips where id = p_slip for update;
  if not found or s.status <> 'active' then raise exception 'ไม่พบใบเตรียมจ่ายหรือถูกยกเลิกแล้ว'; end if;
  for it in select * from payment_slip_items where slip_id = p_slip loop
    if (select paid from slip_doc_info(it.doc_type, it.doc_id)) then raise exception 'เพิ่มเอกสารได้เฉพาะใบที่ยังไม่ชำระเงิน'; end if;
    v_contact := coalesce(v_contact, (select contact_id from slip_doc_info(it.doc_type, it.doc_id)));
  end loop;
  select * into i from slip_doc_info(p_type, p_doc);
  if not found then raise exception 'ไม่พบเอกสารที่เลือก'; end if;
  if not i.payable then raise exception 'เอกสาร % จ่ายไม่ได้ (ต้องรออนุมัติหรืออนุมัติแล้ว และยังไม่จ่าย)', i.doc_no; end if;
  if v_contact is not null and i.contact_id <> v_contact then raise exception 'เพิ่มได้เฉพาะเอกสารของผู้จำหน่ายเดียวกับใบเตรียมจ่าย'; end if;
  if exists (select 1 from payment_slip_items x where x.doc_type = p_type and x.doc_id = p_doc) then
    raise exception 'เอกสาร % อยู่ในใบเตรียมจ่ายอื่นแล้ว', i.doc_no; end if;
  select coalesce(max(line_no), 0) + 1 into v_n from payment_slip_items where slip_id = p_slip;
  insert into payment_slip_items values (p_slip, v_n, p_type, p_doc);
  perform slip_log(p_slip, 'แก้ไขเอกสาร (เพิ่ม ' || i.doc_no || ')');
end $$;

create function remove_slip_doc(p_slip uuid, p_line int) returns void language plpgsql as $$
declare s payment_slips; it payment_slip_items; v_no text;
begin
  select * into s from payment_slips where id = p_slip for update;
  if not found or s.status <> 'active' then raise exception 'ไม่พบใบเตรียมจ่ายหรือถูกยกเลิกแล้ว'; end if;
  select * into it from payment_slip_items where slip_id = p_slip and line_no = p_line;
  if not found then raise exception 'ไม่พบรายการ'; end if;
  if (select paid from slip_doc_info(it.doc_type, it.doc_id)) then raise exception 'ลบเอกสารได้เฉพาะใบที่ยังไม่ชำระเงิน'; end if;
  if (select count(*) from payment_slip_items where slip_id = p_slip) = 1 then raise exception 'ต้องมีเอกสารอย่างน้อย 1 รายการ'; end if;
  v_no := (select doc_no from slip_doc_info(it.doc_type, it.doc_id));
  delete from payment_slip_items where slip_id = p_slip and line_no = p_line;
  perform slip_log(p_slip, 'แก้ไขเอกสาร (ลบ ' || v_no || ')');
end $$;

-- แก้เลขที่เอกสาร: รูปแบบ PAY+ปีเดือนวัน(YYYYMMDD)+4 หลัก · ไม่ซ้ำ · ลำดับต้องไม่เกินเลขล่าสุดที่ออกในเดือนนั้น
create function rename_payment_slip(p_id uuid, p_no text) returns void language plpgsql as $$
declare s payment_slips; v_pre text; v_seq int; v_max int;
begin
  select * into s from payment_slips where id = p_id for update;
  if not found then raise exception 'ไม่พบใบเตรียมจ่าย'; end if;
  if p_no !~ '^PAY[0-9]{12}$' then raise exception 'รูปแบบเลขที่เอกสารไม่ถูกต้อง (ตัวอย่าง PAY202611010001)'; end if;
  v_pre := substr(p_no, 1, 11); v_seq := substr(p_no, 12)::int;
  if v_seq < 1 then raise exception 'ลำดับเลขที่ต้องไม่น้อยกว่า 1'; end if;
  select coalesce(max(substr(pay_no, 12)::int), 0) into v_max from payment_slips where substr(pay_no, 1, 11) = v_pre;
  if v_seq > v_max then raise exception 'เลขที่เอกสารเกินลำดับล่าสุดที่ออกแล้วของวันนั้น (%)', v_max; end if;
  if exists (select 1 from payment_slips where pay_no = p_no and id <> p_id) then raise exception 'เลขที่เอกสาร % ซ้ำ', p_no; end if;
  if p_no = s.pay_no then return; end if;
  update payment_slips set pay_no = p_no where id = p_id;
  perform slip_log(p_id, 'แก้ไขเลขที่เอกสาร ' || s.pay_no || ' → ' || p_no);
end $$;
