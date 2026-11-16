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
    if exists (select 1 from payment_slip_items x join payment_slips ps on ps.id = x.slip_id where ps.status = 'active' and x.doc_type = d->>'type' and x.doc_id = (d->>'id')::uuid) then
      raise exception 'เอกสาร % อยู่ในใบเตรียมจ่ายอื่นแล้ว', i.doc_no;
    end if;
    n := n + 1;
    insert into payment_slip_items values (v_id, n, d->>'type', (d->>'id')::uuid);
  end loop;
  return v_id;
end $$;
create or replace function add_slip_doc(p_slip uuid, p_type text, p_doc uuid) returns void language plpgsql as $$
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
  if exists (select 1 from payment_slip_items x join payment_slips ps on ps.id = x.slip_id where ps.status = 'active' and x.doc_type = p_type and x.doc_id = p_doc) then
    raise exception 'เอกสาร % อยู่ในใบเตรียมจ่ายอื่นแล้ว', i.doc_no; end if;
  select coalesce(max(line_no), 0) + 1 into v_n from payment_slip_items where slip_id = p_slip;
  insert into payment_slip_items values (p_slip, v_n, p_type, p_doc);
  perform slip_log(p_slip, 'แก้ไขเอกสาร (เพิ่ม ' || i.doc_no || ')');
end $$;
