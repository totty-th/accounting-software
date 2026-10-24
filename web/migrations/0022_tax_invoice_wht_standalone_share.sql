create table purchase_tax_invoices (
  doc_type text not null check (doc_type in ('EXP','RI')), doc_id uuid not null,
  invoice_no text not null, invoice_date date not null,
  vat_form text not null default 'PP30' check (vat_form in ('PP30','PP36')),
  vendor_name text not null, vendor_tax_id text check (vendor_tax_id is null or vendor_tax_id ~ '^[0-9]{13}$'), branch text,
  base_amount numeric(18,2) not null, vat_amount numeric(18,2) not null,
  primary key (doc_type, doc_id)
);
create function set_purchase_tax_invoice(p_type text, p_doc uuid, p jsonb) returns void language plpgsql as $$
declare i record; k contacts; v_base numeric; v_vat numeric;
begin
  select * into i from slip_doc_info(p_type, p_doc);
  if not found then raise exception 'ไม่พบเอกสาร'; end if;
  if exists (select 1 from expenses where p_type = 'EXP' and id = p_doc and status in ('rejected','cancelled'))
     or exists (select 1 from goods_receipts where p_type = 'RI' and id = p_doc and status in ('rejected','cancelled')) then
    raise exception 'บันทึกใบกำกับภาษีไม่ได้: เอกสารไม่อนุมัติหรือยกเลิกแล้ว';
  end if;
  select * into k from contacts where id = i.contact_id;
  if coalesce(btrim(p->>'invoice_no'), '') = '' then raise exception 'ต้องระบุเลขที่ใบกำกับภาษี'; end if;
  if p_type = 'EXP' then select subtotal, vat into v_base, v_vat from expenses where id = p_doc;
  else select subtotal, vat into v_base, v_vat from goods_receipts where id = p_doc; end if;
  insert into purchase_tax_invoices(doc_type, doc_id, invoice_no, invoice_date, vat_form, vendor_name, vendor_tax_id, branch, base_amount, vat_amount)
  values (p_type, p_doc, btrim(p->>'invoice_no'), coalesce(nullif(p->>'invoice_date','')::date, i.doc_date),
          coalesce(nullif(p->>'vat_form',''), 'PP30'), coalesce(nullif(p->>'vendor_name',''), coalesce(k.business_name, k.contact_name)),
          coalesce(nullif(p->>'vendor_tax_id',''), k.tax_id), nullif(p->>'branch',''),
          coalesce(nullif(p->>'base_amount','')::numeric, v_base), coalesce(nullif(p->>'vat_amount','')::numeric, v_vat))
  on conflict (doc_type, doc_id) do update set invoice_no = excluded.invoice_no, invoice_date = excluded.invoice_date,
    vat_form = excluded.vat_form, vendor_name = excluded.vendor_name, vendor_tax_id = excluded.vendor_tax_id, branch = excluded.branch,
    base_amount = excluded.base_amount, vat_amount = excluded.vat_amount;
end $$;
create function clear_purchase_tax_invoice(p_type text, p_doc uuid) returns void language sql as $$
  delete from purchase_tax_invoices where doc_type = p_type and doc_id = p_doc;
$$;
create function purchase_tax_invoice_report(p_from date, p_to date)
returns table (invoice_date date, invoice_no text, vendor_name text, vendor_tax_id text, branch text, vat_form text,
               base_amount numeric, vat_amount numeric, doc_type text, doc_no text)
language sql stable as $$
  select t.invoice_date, t.invoice_no, t.vendor_name, t.vendor_tax_id, t.branch, t.vat_form, t.base_amount, t.vat_amount, t.doc_type,
         coalesce((select exp_no from expenses where id = t.doc_id and t.doc_type = 'EXP'),
                  (select ri_no from goods_receipts where id = t.doc_id and t.doc_type = 'RI'))
    from purchase_tax_invoices t
   where t.invoice_date between p_from and p_to
     and not exists (select 1 from expenses e where t.doc_type = 'EXP' and e.id = t.doc_id and e.status in ('rejected','cancelled'))
     and not exists (select 1 from goods_receipts g where t.doc_type = 'RI' and g.id = t.doc_id and g.status in ('rejected','cancelled'))
   order by t.invoice_date, t.invoice_no
$$;
alter table wht_certs alter column expense_id drop not null;
alter table wht_certs add column contact_id uuid references contacts(id);
update wht_certs w set contact_id = e.contact_id from expenses e where e.id = w.expense_id;
create function wht_fill_contact() returns trigger language plpgsql as $$
begin
  if new.contact_id is null and new.expense_id is not null then
    select contact_id into new.contact_id from expenses where id = new.expense_id;
  end if;
  return new;
end $$;
create trigger wht_certs_contact before insert on wht_certs for each row execute function wht_fill_contact();
alter table wht_certs add constraint wht_certs_has_contact check (contact_id is not null or expense_id is not null);
insert into wht_forms values ('PND1K','ภ.ง.ด.1ก',null), ('PND1KS','ภ.ง.ด.1ก (พิเศษ)',null), ('PND2','ภ.ง.ด.2',null),
  ('PND2K','ภ.ง.ด.2ก',null), ('PND3K','ภ.ง.ด.3ก',null);
create table wht_cert_lines (
  cert_id uuid not null references wht_certs(id), line_no int not null,
  income_type text not null, rate numeric(5,2), vat_mode text not null default 'none' check (vat_mode in ('none','exclusive','inclusive')),
  amount numeric(18,2) not null check (amount >= 0), base numeric(18,2) not null, wht numeric(18,2) not null check (wht >= 0),
  primary key (cert_id, line_no)
);
create function create_standalone_wht(p_date date, p_contact uuid, p_form text, p_lines jsonb, p_income_category text default '5')
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid(); l jsonb; n int := 0; v_amt numeric; v_base numeric; v_wht numeric; v_rate numeric; v_vm text;
        t_base numeric := 0; t_wht numeric := 0; v_first text;
begin
  if p_lines is null or jsonb_array_length(p_lines) = 0 then raise exception 'ต้องมีรายการอย่างน้อย 1 บรรทัด'; end if;
  if not exists (select 1 from wht_forms where code = p_form) then raise exception 'ไม่พบแบบฟอร์ม %', p_form; end if;
  if not exists (select 1 from contacts where id = p_contact) then raise exception 'ไม่พบผู้ถูกหักภาษี'; end if;
  perform assert_period_open(p_date);
  insert into wht_certs(id, cert_no, contact_id, form_code, pay_date, base_amount, wht_amount, income_category)
  values (v_id, next_doc_no('WT', p_date, true), p_contact, p_form, p_date, 0, 0, p_income_category);
  for l in select * from jsonb_array_elements(p_lines) loop
    n := n + 1; v_amt := (l->>'amount')::numeric; v_rate := nullif(l->>'rate','')::numeric; v_vm := coalesce(l->>'vat_mode', 'none');
    if coalesce(btrim(l->>'income_type'), '') = '' then raise exception 'ต้องระบุประเภทเงินได้'; end if;
    if v_amt is null or v_amt < 0 then raise exception 'จำนวนเงินไม่ถูกต้อง'; end if;
    v_base := case v_vm when 'inclusive' then round(v_amt * 100 / 107, 2) else v_amt end;
    if v_rate is not null then v_wht := round(v_base * v_rate / 100, 2);
    else v_wht := (l->>'wht')::numeric; if v_wht is null or v_wht < 0 then raise exception 'ต้องระบุอัตราหรือจำนวนภาษีที่หัก'; end if; end if;
    insert into wht_cert_lines values (v_id, n, l->>'income_type', v_rate, v_vm, v_amt, v_base, v_wht);
    t_base := t_base + v_base; t_wht := t_wht + v_wht; v_first := coalesce(v_first, l->>'income_type');
  end loop;
  update wht_certs set base_amount = t_base, wht_amount = t_wht, income_type = v_first where id = v_id;
  return v_id;
end $$;
create or replace function wht_cert_data(p_id uuid) returns jsonb language plpgsql stable as $$
declare c wht_certs; k contacts; p company_profile; v_missing text[] := '{}'; v_form text;
begin
  select * into c from wht_certs where id = p_id;
  if not found then raise exception 'ไม่พบหนังสือรับรอง'; end if;
  if c.status <> 'active' then raise exception 'หนังสือรับรองนี้ถูกยกเลิกแล้ว'; end if;
  select * into k from contacts where id = c.contact_id;
  select * into p from company_profile;
  if not found then v_missing := array_append(v_missing, 'ข้อมูลบริษัทผู้จ่าย'); end if;
  if k.tax_id is null or k.tax_id !~ '^[0-9]{13}$' then v_missing := array_append(v_missing, 'เลขประจำตัวผู้เสียภาษี 13 หลักของผู้ถูกหัก'); end if;
  if coalesce(btrim(k.address), '') = '' then v_missing := array_append(v_missing, 'ที่อยู่ผู้ถูกหัก'); end if;
  if k.person_kind is null then v_missing := array_append(v_missing, 'ประเภทบุคคลของผู้ถูกหัก'); end if;
  v_form := case c.form_code when 'PND53' then '7' when 'PND3' then '4' else null end;
  return jsonb_build_object(
    'cert_no', c.cert_no, 'book_no', c.book_no, 'run_no', c.run_no, 'seq_in_form', c.seq_in_form,
    'form_choice', v_form,
    'payer', jsonb_build_object('name', p.name, 'address', p.address, 'tax_id', p.tax_id, 'person_kind', p.person_kind),
    'payee', jsonb_build_object('name', coalesce(k.business_name, k.contact_name), 'address', k.address,
                                'tax_id', k.tax_id, 'person_kind', k.person_kind),
    'income_category', c.income_category, 'income_note', c.income_type,
    'pay_date', c.pay_date, 'base_amount', c.base_amount, 'wht_amount', c.wht_amount,
    'payer_condition', c.payer_condition, 'payer_condition_note', c.payer_condition_note,
    'fund_gpf', c.fund_gpf, 'fund_sso', c.fund_sso, 'fund_pvd', c.fund_pvd,
    'issue_date', c.pay_date, 'missing', to_jsonb(v_missing));
end $$;
alter table purchase_orders add column share_token text unique;
alter table goods_receipts add column share_token text unique;
alter table payment_slips add column share_token text unique;
create function ensure_purchase_share_token(p_kind text, p_id uuid) returns text language plpgsql as $$
declare v text;
begin
  if p_kind = 'PO' then select share_token into v from purchase_orders where id = p_id for update;
  elsif p_kind = 'RI' then select share_token into v from goods_receipts where id = p_id for update;
  elsif p_kind = 'PAY' then select share_token into v from payment_slips where id = p_id for update;
  else raise exception 'ชนิดเอกสารไม่ถูกต้อง'; end if;
  if not found then raise exception 'ไม่พบเอกสาร'; end if;
  if v is null then
    v := substr(replace(gen_random_uuid()::text, '-', ''), 1, 26);
    if p_kind = 'PO' then update purchase_orders set share_token = v where id = p_id;
    elsif p_kind = 'RI' then update goods_receipts set share_token = v where id = p_id;
    else update payment_slips set share_token = v where id = p_id; end if;
  end if;
  return v;
end $$;
create function revoke_purchase_share_token(p_kind text, p_id uuid) returns void language plpgsql as $$
begin
  if p_kind = 'PO' then update purchase_orders set share_token = null where id = p_id;
  elsif p_kind = 'RI' then update goods_receipts set share_token = null where id = p_id;
  elsif p_kind = 'PAY' then update payment_slips set share_token = null where id = p_id;
  else raise exception 'ชนิดเอกสารไม่ถูกต้อง'; end if;
end $$;
create function purchase_doc_by_token(p_token text) returns table (kind text, id uuid) language sql stable as $$
  select 'PO'::text, id from purchase_orders where share_token = p_token and p_token is not null
  union all select 'RI', id from goods_receipts where share_token = p_token and p_token is not null
  union all select 'PAY', id from payment_slips where share_token = p_token and p_token is not null
$$;
