-- M27.10: ยื่น ภ.พ.36 กับเอกสารที่รายการค่าใช้จ่ายไม่มี VAT ทำให้ใบสำคัญมีบรรทัด 0 บาทแล้ว error ภาษาอังกฤษ → ตรวจและแจ้งเป็นไทย
create or replace function file_pp36(p_month date, p_docs jsonb) returns uuid language plpgsql as $$
declare m_start date := date_trunc('month', p_month)::date; m_end date; v_id uuid := gen_random_uuid(); d jsonb; t record; v_uv uuid;
        v_doc_vat numeric; v_uv_id uuid; v_acc text; v_base numeric := 0; v_vat numeric := 0; v_costs jsonb := '{}'::jsonb; v_cost_total numeric := 0; v_lines jsonb;
begin
  m_end := (m_start + interval '1 month' - interval '1 day')::date;
  if coalesce(jsonb_array_length(p_docs), 0) = 0 then raise exception 'ต้องเลือกใบกำกับอย่างน้อย 1 รายการ'; end if;
  insert into pp36_filings(id, period_month, base_amount, vat_amount) values (v_id, m_start, 0, 0);
  for d in select * from jsonb_array_elements(p_docs) loop
    select * into t from purchase_tax_invoices where doc_type = d->>'type' and doc_id = (d->>'id')::uuid;
    if not found or t.vat_form <> 'PP36' then raise exception 'เอกสารที่เลือกไม่มีใบกำกับแบบ ภ.พ.36'; end if;
    if date_trunc('month', t.invoice_date)::date <> m_start then raise exception 'ใบกำกับ % ไม่ได้ลงวันที่ในเดือนที่ยื่นแบบ', t.invoice_no; end if;
    if exists (select 1 from pp36_filing_docs where doc_type = t.doc_type and doc_id = t.doc_id) then raise exception 'ใบกำกับ % อยู่ในแบบ ภ.พ.36 แล้ว', t.invoice_no; end if;
    v_doc_vat := null;
    if t.doc_type = 'EXP' then select vat, uv_voucher_id into v_doc_vat, v_uv_id from expenses where id = t.doc_id and status not in ('rejected','cancelled');
    else select vat, uv_voucher_id into v_doc_vat, v_uv_id from goods_receipts where id = t.doc_id and status not in ('rejected','cancelled'); end if;
    if v_doc_vat is null then raise exception 'เอกสารของใบกำกับ % ไม่อนุมัติหรือยกเลิกแล้ว', t.invoice_no; end if;
    if v_uv_id is null then raise exception 'เอกสารของใบกำกับ % ยังไม่ลงบัญชี (รออนุมัติ)', t.invoice_no; end if;
    if coalesce(v_doc_vat,0) <= 0 then raise exception 'เอกสารของใบกำกับ % ไม่มีภาษีซื้อ ภ.พ.36 ในรายการค่าใช้จ่าย (ต้องใส่ VAT 7%% ในรายการ ไม่ใช่ 0%%) จึงยื่นแบบไม่ได้', t.invoice_no; end if;
    select a.code into v_acc from journal_lines l join accounts a on a.id = l.account_id
     where l.voucher_id = v_uv_id and l.debit > 0 and a.code <> '17113' order by l.debit desc, l.line_no limit 1;
    if v_acc is null then raise exception 'ไม่พบบัญชีต้นทุนของเอกสารใบกำกับ %', t.invoice_no; end if;
    v_costs := jsonb_set(v_costs, array[v_acc], to_jsonb(coalesce((v_costs->>v_acc)::numeric, 0) + v_doc_vat));
    v_cost_total := v_cost_total + v_doc_vat;
    insert into pp36_filing_docs(filing_id, doc_type, doc_id, base_amount, vat_amount) values (v_id, t.doc_type, t.doc_id, t.base_amount, t.vat_amount);
    v_base := v_base + t.base_amount; v_vat := v_vat + t.vat_amount;
  end loop;
  v_lines := '[]'::jsonb;
  for t in select key as code, value::text::numeric as amt from jsonb_each(v_costs) loop
    v_lines := v_lines || jsonb_build_object('account', t.code, 'debit', t.amt);
  end loop;
  v_lines := v_lines || jsonb_build_object('account', '17113', 'credit', v_cost_total);
  v_uv := post_voucher('UV', m_end, 'บันทึกรายการภาษี ภ.พ.36 เดือนภาษี ' || to_char(m_start, 'MM-YYYY'), 'PP36', v_id::text, v_lines);
  update pp36_filings set base_amount = v_base, vat_amount = v_vat, uv_voucher_id = v_uv,
         jv_voucher_id = case when v_vat > 0 then post_voucher('JV', m_end, 'บันทึกภาษีมูลค่าเพิ่มจากการสร้างแบบยื่น ภ.พ.36 เดือนภาษี ' || to_char(m_start, 'MM-YYYY'), 'PP36', v_id::text,
           jsonb_build_array(jsonb_build_object('account','17113','debit',v_vat), jsonb_build_object('account','27140','credit',v_vat))) end
   where id = v_id;
  return v_id;
end $$;
