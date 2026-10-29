-- M27.5 ภ.พ.30 แบบเลือกใบกำกับภาษีซื้อ + ยื่นเพิ่มเติม + ใบเสร็จสรรพากรของ ภ.พ.36 (REA FA 29-10-2026 ทดสอบจริงในบริษัททดลอง)
-- • ภาษีขาย = ยอด 27111 ของเดือนที่ยังไม่ถูกยื่นในแบบก่อนหน้า (แบบเพิ่มเติมเห็นเฉพาะส่วนที่เพิ่มมา)
-- • ภาษีซื้อ = ใบกำกับที่ผู้ใช้ติ๊กเลือก: ใบกำกับ ภ.พ.30 ที่รับแล้ว, หรือใบกำกับ ภ.พ.36 ที่ยื่น+ชำระแล้วและบันทึกเลขใบเสร็จสรรพากรแล้ว
-- • ลงบัญชี (ตามที่เห็นใน FA)  UV Dr 17111 (ภ.พ.30) / Dr 17112 (ภ.พ.36) / Cr 17113
--                              JV Dr 27111 ภาษีขาย / Cr 17111 / Cr 17112 / Cr 27140 (ต้องชำระ) หรือ Dr 17114 (ขอคืน)
--   FA ทำ UV แยกตามเอกสาร เราทำ UV ใบเดียวรวมทุกเอกสารของแบบ (ยอดบัญชีเท่ากัน)
-- • ยื่นหลายแบบต่อเดือนได้เมื่อระบุเอกสาร · เรียก file_pp30(เดือน) แบบไม่ระบุเอกสาร = โหมดเดิม (ใช้ยอด 17113 ทั้งเดือน, ยื่นได้แบบเดียว)
insert into accounts(code, name, type) values ('17112', 'ภาษีซื้อ ภ.พ.36', 'asset') on conflict (code) do nothing;

drop index pp30_one_active_per_month;
alter table pp30_filings add column seq int not null default 0;            -- 0 = ยื่นปกติ · n = ยื่นเพิ่มเติม-n
alter table pp30_filings add column auto_mode boolean not null default true; -- true = โหมดเดิม (ไม่ได้เลือกเอกสาร)
create table pp30_filing_docs (
  filing_id uuid not null references pp30_filings(id) on delete cascade,
  doc_type text not null check (doc_type in ('EXP','RI')), doc_id uuid not null,
  vat_form text not null check (vat_form in ('PP30','PP36')),
  vat_amount numeric(18,2) not null,
  primary key (doc_type, doc_id)
);

-- ใบเสร็จสรรพากรของ ภ.พ.36 (FA: หลังชำระแล้วสถานะเอกสาร = "รอใบเสร็จสรรพากร" จนกว่าจะบันทึกเลขที่ใบเสร็จ จึงจะนำภาษีไปใช้สิทธิ์ใน ภ.พ.30 ได้)
alter table pp36_filing_docs add column rd_receipt_no text, add column rd_receipt_date date;

create function set_pp36_receipt(p_type text, p_doc uuid, p_no text, p_date date) returns void language plpgsql as $$
declare d pp36_filing_docs; f pp36_filings;
begin
  select * into d from pp36_filing_docs where doc_type = p_type and doc_id = p_doc for update;
  if not found then raise exception 'เอกสารนี้ยังไม่อยู่ในแบบ ภ.พ.36'; end if;
  select * into f from pp36_filings where id = d.filing_id;
  if f.pv_voucher_id is null then raise exception 'ต้องบันทึกชำระ ภ.พ.36 ก่อนจึงจะบันทึกใบเสร็จสรรพากรได้'; end if;
  if exists (select 1 from pp30_filing_docs where doc_type = p_type and doc_id = p_doc) then
    raise exception 'ภาษีของเอกสารนี้ถูกใช้สิทธิ์ใน ภ.พ.30 แล้ว ต้องลบแบบ ภ.พ.30 ก่อน';
  end if;
  if coalesce(btrim(p_no), '') = '' then
    update pp36_filing_docs set rd_receipt_no = null, rd_receipt_date = null where doc_type = p_type and doc_id = p_doc;   -- ล้างใบเสร็จ
  else
    update pp36_filing_docs set rd_receipt_no = btrim(p_no), rd_receipt_date = coalesce(p_date, f.paid_date) where doc_type = p_type and doc_id = p_doc;
  end if;
end $$;

create or replace function reset_pp36_payment(p_id uuid) returns void language plpgsql as $$
declare f pp36_filings;
begin
  select * into f from pp36_filings where id = p_id for update;
  if not found or f.pv_voucher_id is null then raise exception 'ยังไม่ได้บันทึกชำระ'; end if;
  if exists (select 1 from pp36_filing_docs where filing_id = p_id and rd_receipt_no is not null) then
    raise exception 'ต้องล้างเลขใบเสร็จสรรพากรของเอกสารในแบบก่อนรีเซ็ตการชำระ';
  end if;
  perform reverse_voucher(f.pv_voucher_id);
  update pp36_filings set pv_voucher_id = null, paid_date = null where id = p_id;
end $$;

drop function file_pp30(date);
create function file_pp30(p_month date, p_docs jsonb default null) returns uuid language plpgsql as $$
declare m_start date := date_trunc('month', p_month)::date; m_end date;
        v_out numeric; v_in numeric; v_in30 numeric := 0; v_in36 numeric := 0; v_id uuid := gen_random_uuid(); v_res text; v_amt numeric;
        v_uv uuid; v_jv uuid; v_lines jsonb; v_seq int; d jsonb; t purchase_tax_invoices; v_vat numeric; v_auto boolean := p_docs is null;
begin
  m_end := (m_start + interval '1 month' - interval '1 day')::date;
  if v_auto and exists (select 1 from pp30_filings where period_month = m_start and status = 'filed') then
    raise exception 'เดือนนี้มีแบบ ภ.พ.30 ที่ยื่นแล้ว ต้องลบแบบเดิมก่อน';
  end if;
  if not v_auto and coalesce(jsonb_array_length(p_docs), 0) = 0 and exists (select 1 from pp30_filings where period_month = m_start and status = 'filed' and auto_mode) then
    raise exception 'เดือนนี้มีแบบ ภ.พ.30 ที่ยื่นแล้ว ต้องลบแบบเดิมก่อน';
  end if;
  select count(*) into v_seq from pp30_filings where period_month = m_start and status = 'filed';
  select coalesce(sum(l.credit - l.debit), 0) into v_out
    from journal_lines l join journal_vouchers v on v.id = l.voucher_id join accounts a on a.id = l.account_id
   where a.code = '27111' and v.voucher_date between m_start and m_end and v.source_type is distinct from 'PP30';
  v_out := v_out - coalesce((select sum(output_vat) from pp30_filings where period_month = m_start and status = 'filed'), 0);
  if v_auto then
    select coalesce(sum(l.debit - l.credit), 0) into v_in
      from journal_lines l join journal_vouchers v on v.id = l.voucher_id join accounts a on a.id = l.account_id
     where a.code = '17113' and v.voucher_date between m_start and m_end and v.source_type is distinct from 'PP30';
    v_in30 := v_in;
  else
    insert into pp30_filings(id, period_month, output_vat, input_vat, result, amount, seq, auto_mode) values (v_id, m_start, 0, 0, 'zero', 0, v_seq, false);
    for d in select * from jsonb_array_elements(p_docs) loop
      select * into t from purchase_tax_invoices where doc_type = d->>'type' and doc_id = (d->>'id')::uuid;
      if not found then raise exception 'เอกสารที่เลือกไม่มีใบกำกับภาษี'; end if;
      if date_trunc('month', t.invoice_date)::date <> m_start then raise exception 'ใบกำกับ % ไม่ได้ลงวันที่ในเดือนที่ยื่นแบบ', t.invoice_no; end if;
      if exists (select 1 from pp30_filing_docs where doc_type = t.doc_type and doc_id = t.doc_id) then raise exception 'ใบกำกับ % ถูกใช้ในแบบ ภ.พ.30 แล้ว', t.invoice_no; end if;
      if exists (select 1 from expenses e where t.doc_type = 'EXP' and e.id = t.doc_id and e.status in ('rejected','cancelled'))
         or exists (select 1 from goods_receipts g where t.doc_type = 'RI' and g.id = t.doc_id and g.status in ('rejected','cancelled')) then
        raise exception 'เอกสารของใบกำกับ % ไม่อนุมัติหรือยกเลิกแล้ว', t.invoice_no;
      end if;
      if t.vat_form = 'PP30' then
        v_vat := t.vat_amount; v_in30 := v_in30 + v_vat;
      else
        select vat_amount into v_vat from pp36_filing_docs f where f.doc_type = t.doc_type and f.doc_id = t.doc_id and f.rd_receipt_no is not null
           and exists (select 1 from pp36_filings p where p.id = f.filing_id and p.status = 'filed' and p.pv_voucher_id is not null);
        if v_vat is null then raise exception 'ใบกำกับ % (ภ.พ.36) ยังไม่ได้ยื่น/ชำระ หรือยังไม่ได้บันทึกใบเสร็จสรรพากร', t.invoice_no; end if;
        v_in36 := v_in36 + v_vat;
      end if;
      insert into pp30_filing_docs(filing_id, doc_type, doc_id, vat_form, vat_amount) values (v_id, t.doc_type, t.doc_id, t.vat_form, v_vat);
    end loop;
    v_in := v_in30 + v_in36;
  end if;
  if v_out < 0 or v_in < 0 then raise exception 'ยอดภาษีติดลบ กรุณาตรวจสอบรายการเดือนนี้'; end if;
  v_res := case when v_out > v_in then 'payable' when v_in > v_out then 'refund' else 'zero' end;
  v_amt := abs(v_out - v_in);
  if v_auto then
    insert into pp30_filings(id, period_month, output_vat, input_vat, result, amount, seq, auto_mode) values (v_id, m_start, v_out, v_in, v_res, v_amt, v_seq, true);
  else
    update pp30_filings set output_vat = v_out, input_vat = v_in, result = v_res, amount = v_amt where id = v_id;
  end if;
  if v_in > 0 then
    v_lines := '[]'::jsonb;
    if v_in30 > 0 then v_lines := v_lines || jsonb_build_object('account','17111','debit',v_in30); end if;
    if v_in36 > 0 then v_lines := v_lines || jsonb_build_object('account','17112','debit',v_in36); end if;
    v_lines := v_lines || jsonb_build_object('account','17113','credit',v_in);
    v_uv := post_voucher('UV', m_end, case when v_auto then 'ภ.พ.30 ย้ายภาษีซื้อ' else 'บันทึกรายการภาษีซื้อ ภ.พ.30 สำหรับรอบเดือนภาษี ' || to_char(m_start, 'MM-YYYY') end, 'PP30', v_id::text, v_lines);
  end if;
  v_lines := '[]'::jsonb;
  if v_out > 0 then v_lines := v_lines || jsonb_build_object('account','27111','debit',v_out); end if;
  if v_res = 'refund' then v_lines := v_lines || jsonb_build_object('account','17114','debit',v_amt); end if;
  if v_in30 > 0 then v_lines := v_lines || jsonb_build_object('account','17111','credit',v_in30); end if;
  if v_in36 > 0 then v_lines := v_lines || jsonb_build_object('account','17112','credit',v_in36); end if;
  if v_res = 'payable' then v_lines := v_lines || jsonb_build_object('account','27140','credit',v_amt); end if;
  if jsonb_array_length(v_lines) >= 2 then
    v_jv := post_voucher('JV', m_end, case when v_auto then 'ภ.พ.30 หักกลบภาษี' else 'บันทึกภาษีมูลค่าเพิ่มจากการสร้างแบบยื่น ภ.พ.30 สำหรับรอบเดือน ' || to_char(m_start, 'MM-YYYY') end, 'PP30', v_id::text, v_lines);
  end if;
  update pp30_filings set uv_voucher_id = v_uv, jv_voucher_id = v_jv where id = v_id;
  return v_id;
end $$;

create or replace function delete_pp30(p_id uuid) returns void language plpgsql as $$
declare f pp30_filings;
begin
  select * into f from pp30_filings where id = p_id for update;
  if not found or f.status = 'deleted' then raise exception 'ไม่พบแบบหรือถูกลบแล้ว'; end if;
  if f.pv_voucher_id is not null then raise exception 'ต้องรีเซ็ตการชำระก่อนลบแบบ'; end if;
  if f.uv_voucher_id is not null then perform reverse_voucher(f.uv_voucher_id); end if;
  if f.jv_voucher_id is not null then perform reverse_voucher(f.jv_voucher_id); end if;
  delete from pp30_filing_docs where filing_id = p_id;
  update pp30_filings set status = 'deleted' where id = p_id;
end $$;
