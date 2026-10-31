-- M27.11: เก็บเงินขายสด (CA) เลือกช่องทางรับได้: เงินสด (11112 เหมือนเดิม) หรือโอนเข้าบัญชีธนาคารที่เลือก
-- (ช่องทางอื่น เช็ค/บัตร ยังไม่ทดสอบ จึงไม่เพิ่ม — ตรงกับใบเสร็จ)
drop function if exists collect_cash_sale(uuid, date);
create function collect_cash_sale(p_id uuid, p_date date, p_bank_account uuid default null) returns void language plpgsql as $$
declare d sales_docs; v uuid; ac text := '11112';
begin
  select * into d from sales_docs where id = p_id and doc_type = 'CA' for update;
  if not found or d.status <> 'pending_collect' then raise exception 'เก็บเงินได้เฉพาะขายสดที่รอเก็บเงิน'; end if;
  if p_bank_account is not null then
    select a.code into ac from bank_accounts b join accounts a on a.id = b.account_id where b.id = p_bank_account and b.is_active;
    if ac is null then raise exception 'ไม่พบบัญชีธนาคารที่เลือก'; end if;
  end if;
  v := post_voucher('RV', p_date, null, 'CA-COLLECT', p_id::text,
        jsonb_build_array(jsonb_build_object('account', ac, 'debit', d.total),
                          jsonb_build_object('account','11319','credit', d.total)));
  update sales_docs set status = 'collected', collect_voucher_id = v where id = p_id;
end $$;
