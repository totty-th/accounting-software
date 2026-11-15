-- M30.2 RI ที่ตั้งหัก ณ ที่จ่ายที่บรรทัด: ลงบัญชีตอนจ่าย (ทดสอบ FA 15-11-2026, RI 6,000 หัก 3% = 180)
--  PV: Dr 21311 ยอดเต็ม 6,420 / Cr 27124 ภาษีหัก ณ ที่จ่าย 180 / Cr เงินสด 6,240 · ไม่ออกใบ 50 ทวิอัตโนมัติ (FA ไม่ออก)
--  รีเซ็ตกลับ PV ทั้งใบอยู่แล้ว (reset_goods_receipt ล้าง wht_paid)
drop function pay_goods_receipt(uuid, date, jsonb, text);
create function pay_goods_receipt(p_id uuid, p_date date, p_payments jsonb, p_short_reason text default null) returns uuid language plpgsql as $$
declare r goods_receipts; v uuid; v_cr jsonb; v_lines jsonb; f wht_forms;
begin
  select * into r from goods_receipts where id = p_id for update;
  if not found or r.status not in ('unpaid','approved') then raise exception 'จ่ายเงินได้เฉพาะใบรับสินค้าที่ยังไม่จ่าย'; end if;
  v_cr := record_purchase_payments('RI', p_id, p_date, p_payments, r.total - r.wht_total, '11112', p_short_reason);
  v_lines := jsonb_build_array(jsonb_build_object('account','21311','debit',r.total));
  if r.wht_total > 0 then
    select * into f from wht_forms where code = 'PND53';
    v_lines := v_lines || jsonb_build_object('account', f.account_code, 'credit', r.wht_total);
  end if;
  v := post_voucher('PV', p_date, null, 'RI-PAY', p_id::text, v_lines || v_cr);
  update goods_receipts set status = 'paid', pv_voucher_id = v, wht_paid = r.wht_total where id = p_id;
  return v;
end $$;
