-- หัก ณ ที่จ่ายอิสระ: รีเซ็ต/ดำเนินการ ตามต้นแบบ (REA 01-11-2026)
--   ดำเนินการแล้ว → ยกเลิก | รีเซ็ต · ยกเลิก → รีเซ็ต · รอดำเนินการ → ดำเนินการแล้ว
-- ใบที่ออกจากค่าใช้จ่าย (expense_id ไม่ว่าง) ใช้รีเซ็ตที่ค่าใช้จ่ายเท่านั้น · รายงานนับเฉพาะ active
alter table wht_certs drop constraint if exists wht_certs_status_check;
alter table wht_certs add constraint wht_certs_status_check check (status in ('active','cancelled','pending'));

create function reset_wht_cert(p_id uuid) returns void language plpgsql as $$
declare c wht_certs;
begin
  select * into c from wht_certs where id = p_id for update;
  if not found then raise exception 'ไม่พบหนังสือรับรอง'; end if;
  if c.expense_id is not null then raise exception 'ใบที่ออกจากค่าใช้จ่ายต้องรีเซ็ตที่ค่าใช้จ่าย'; end if;
  if c.status = 'pending' then raise exception 'หนังสือรับรองนี้รอดำเนินการอยู่แล้ว'; end if;
  update wht_certs set status = 'pending' where id = p_id;
end $$;

create function activate_wht_cert(p_id uuid) returns void language plpgsql as $$
begin
  update wht_certs set status = 'active' where id = p_id and status = 'pending';
  if not found then raise exception 'ดำเนินการได้เฉพาะหนังสือรับรองที่รอดำเนินการ'; end if;
end $$;
