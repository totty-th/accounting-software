-- M27.10: เงินสดย่อยห้ามติดลบ (พบจากทดสอบ production 31-10-2026: จ่าย 1,040 จากเงินสดย่อยที่มี 1,000 ได้โดยไม่เตือน)
-- ตรวจที่ระดับรายการบัญชี ครอบทุกทางที่ตัดเงินสดย่อย (จ่ายค่าใช้จ่าย/ใบรับสินค้า/โอนออก/กลับรายการเติมเงิน)
create function guard_petty_overdraw() returns trigger language plpgsql as $$
declare v_name text; v_bal numeric;
begin
  if NEW.credit > 0 then
    select f.fund_name into v_name from petty_funds f where f.account_id = NEW.account_id;
    if v_name is not null then
      select coalesce(sum(debit - credit), 0) into v_bal from journal_lines where account_id = NEW.account_id;
      if v_bal < 0 then
        raise exception 'เงินสดย่อย "%" ไม่พอ: คงเหลือก่อนรายการนี้ % บาท แต่ต้องใช้ % บาท (เติมเงินสดย่อยก่อน)', v_name, v_bal + NEW.credit, NEW.credit;
      end if;
    end if;
  end if;
  return null;
end $$;
create trigger trg_guard_petty_overdraw after insert on journal_lines for each row execute function guard_petty_overdraw();
