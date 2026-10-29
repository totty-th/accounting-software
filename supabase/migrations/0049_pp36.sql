-- M27.5 ภ.พ.36 (REA FA 29-10-2026 ทดสอบจริงในบริษัททดลอง)
-- • รับใบกำกับแบบ ภ.พ.36: ฐานภาษี = มูลค่าที่จ่ายจริง (ค่าเริ่มต้น = ยอดรวมเอกสาร) · VAT = 7% ของฐาน (ปัดสตางค์)  เช่น 1,070 → 74.90
-- • เตรียมแบบ: เลือกใบกำกับ ภ.พ.36 ของเดือน → ลงบัญชีวันสิ้นเดือน
--     UV  Dr บัญชีต้นทุน/ค่าใช้จ่ายของเอกสาร (ภาษีที่ผู้ขายคิดไว้เดิมใน 17113 ถูกตัดเป็นต้นทุน) / Cr 17113
--     JV  Dr 17113 ภาษีซื้อยังไม่ถึงกำหนด / Cr 27140 เจ้าหนี้สรรพากร (ยอดภาษี ภ.พ.36)
-- • ชำระ: PV Dr 27140 / Cr ช่องทางชำระ (สมมติเหมือน ภ.พ.30 — ยังไม่ได้ทดสอบการชำระใน FA)
-- • ยื่นหลายแบบต่อเดือนได้ (ยื่นเพิ่มเติม) แต่ใบกำกับหนึ่งใบอยู่ได้แบบเดียวที่ใช้งานอยู่
create table pp36_filings (
  id uuid primary key default gen_random_uuid(),
  period_month date not null,                       -- วันที่ 1 ของเดือนภาษี
  status text not null default 'filed' check (status in ('filed','deleted')),
  base_amount numeric(18,2) not null, vat_amount numeric(18,2) not null,
  uv_voucher_id uuid references journal_vouchers(id), jv_voucher_id uuid references journal_vouchers(id), pv_voucher_id uuid references journal_vouchers(id),
  paid_date date, created_at timestamptz not null default now()
);
create table pp36_filing_docs (
  filing_id uuid not null references pp36_filings(id) on delete cascade,
  doc_type text not null check (doc_type in ('EXP','RI')), doc_id uuid not null,
  base_amount numeric(18,2) not null, vat_amount numeric(18,2) not null,
  primary key (doc_type, doc_id)
);

create or replace function set_purchase_tax_invoice(p_type text, p_doc uuid, p jsonb) returns void language plpgsql as $$
declare i record; k contacts; v_base numeric; v_vat numeric; v_form text := coalesce(nullif(p->>'vat_form',''), 'PP30'); v_total numeric;
begin
  select * into i from slip_doc_info(p_type, p_doc);
  if not found then raise exception 'ไม่พบเอกสาร'; end if;
  if exists (select 1 from expenses where p_type = 'EXP' and id = p_doc and status in ('rejected','cancelled'))
     or exists (select 1 from goods_receipts where p_type = 'RI' and id = p_doc and status in ('rejected','cancelled')) then
    raise exception 'บันทึกใบกำกับภาษีไม่ได้: เอกสารไม่อนุมัติหรือยกเลิกแล้ว';
  end if;
  if v_form not in ('PP30','PP36') then raise exception 'แบบฟอร์มภาษีไม่ถูกต้อง'; end if;
  if exists (select 1 from pp36_filing_docs where doc_type = p_type and doc_id = p_doc) then
    raise exception 'เอกสารนี้อยู่ในแบบ ภ.พ.36 ที่ยื่นแล้ว ต้องลบแบบก่อนแก้ใบกำกับ';
  end if;
  select * into k from contacts where id = i.contact_id;
  if coalesce(btrim(p->>'invoice_no'), '') = '' then raise exception 'ต้องระบุเลขที่ใบกำกับภาษี'; end if;
  if p_type = 'EXP' then select subtotal, vat, total into v_base, v_vat, v_total from expenses where id = p_doc;
  else select subtotal, vat, total into v_base, v_vat, v_total from goods_receipts where id = p_doc; end if;
  if v_form = 'PP36' then
    v_base := coalesce(nullif(p->>'base_amount','')::numeric, v_total);
    v_vat := coalesce(nullif(p->>'vat_amount','')::numeric, round(v_base * 0.07, 2));
  else
    v_base := coalesce(nullif(p->>'base_amount','')::numeric, v_base);
    v_vat := coalesce(nullif(p->>'vat_amount','')::numeric, v_vat);
  end if;
  insert into purchase_tax_invoices(doc_type, doc_id, invoice_no, invoice_date, vat_form, vendor_name, vendor_tax_id, branch, base_amount, vat_amount)
  values (p_type, p_doc, btrim(p->>'invoice_no'), coalesce(nullif(p->>'invoice_date','')::date, i.doc_date),
          v_form, coalesce(nullif(p->>'vendor_name',''), coalesce(k.business_name, k.contact_name)),
          coalesce(nullif(p->>'vendor_tax_id',''), k.tax_id), nullif(p->>'branch',''), v_base, v_vat)
  on conflict (doc_type, doc_id) do update set invoice_no = excluded.invoice_no, invoice_date = excluded.invoice_date,
    vat_form = excluded.vat_form, vendor_name = excluded.vendor_name, vendor_tax_id = excluded.vendor_tax_id, branch = excluded.branch,
    base_amount = excluded.base_amount, vat_amount = excluded.vat_amount;
end $$;

-- p_docs = [{"type":"EXP|RI","id":"..."}] ต้องมีใบกำกับแบบ ภ.พ.36 ลงวันที่ในเดือนที่ยื่น และเอกสารอนุมัติแล้ว (มีใบสำคัญ) · ยังไม่อยู่ในแบบอื่น
create function file_pp36(p_month date, p_docs jsonb) returns uuid language plpgsql as $$
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

create function pay_pp36(p_id uuid, p_date date, p_pay_account text default '11112') returns uuid language plpgsql as $$
declare f pp36_filings; v uuid;
begin
  select * into f from pp36_filings where id = p_id for update;
  if not found or f.status <> 'filed' or f.vat_amount <= 0 then raise exception 'ไม่พบแบบ ภ.พ.36 ที่ต้องชำระ'; end if;
  if f.pv_voucher_id is not null then raise exception 'บันทึกชำระแล้ว'; end if;
  v := post_voucher('PV', p_date, 'ชำระ ภ.พ.36', 'PP36-PAY', p_id::text, jsonb_build_array(
        jsonb_build_object('account','27140','debit',f.vat_amount), jsonb_build_object('account',p_pay_account,'credit',f.vat_amount)));
  update pp36_filings set pv_voucher_id = v, paid_date = p_date where id = p_id;
  return v;
end $$;

create function reset_pp36_payment(p_id uuid) returns void language plpgsql as $$
declare f pp36_filings;
begin
  select * into f from pp36_filings where id = p_id for update;
  if not found or f.pv_voucher_id is null then raise exception 'ยังไม่ได้บันทึกชำระ'; end if;
  perform reverse_voucher(f.pv_voucher_id);
  update pp36_filings set pv_voucher_id = null, paid_date = null where id = p_id;
end $$;

-- ลบแบบ = กลับรายการ UV/JV (-R) · ใบกำกับกลับไปรอยื่น ภ.พ.36
create function delete_pp36(p_id uuid) returns void language plpgsql as $$
declare f pp36_filings;
begin
  select * into f from pp36_filings where id = p_id for update;
  if not found or f.status = 'deleted' then raise exception 'ไม่พบแบบหรือถูกลบแล้ว'; end if;
  if f.pv_voucher_id is not null then raise exception 'ต้องรีเซ็ตการชำระก่อนลบแบบ'; end if;
  if f.uv_voucher_id is not null then perform reverse_voucher(f.uv_voucher_id); end if;
  if f.jv_voucher_id is not null then perform reverse_voucher(f.jv_voucher_id); end if;
  delete from pp36_filing_docs where filing_id = p_id;
  update pp36_filings set status = 'deleted' where id = p_id;
end $$;
