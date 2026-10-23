-- M7 หนังสือรับรองการหักภาษี ณ ที่จ่าย (50 ทวิ) ตามแบบมาตรฐานกรมสรรพากร
-- ข้อมูลที่ต้องมีเพิ่ม: ข้อมูลบริษัทผู้จ่าย, ที่อยู่/ประเภทบุคคลของผู้ถูกหัก, เล่มที่/เลขที่/ลำดับที่ในแบบ, ประเภทเงินได้ 1-6, เงื่อนไขผู้จ่าย
-- ฐานภาษีในใบ = ยอดก่อน VAT ของรายการที่ถูกหักเท่านั้น (pay_expense ทำอยู่แล้ว)

create table company_profile (
  singleton    boolean primary key default true check (singleton),
  name         text not null,
  address      text not null,
  tax_id       text not null check (tax_id ~ '^[0-9]{13}$'),
  person_kind  text not null default 'juristic' check (person_kind in ('individual','juristic'))
);

alter table contacts
  add column address     text,
  add column person_kind text check (person_kind in ('individual','juristic'));

alter table wht_certs
  add column book_no        text,
  add column run_no         text,
  add column seq_in_form    int check (seq_in_form is null or seq_in_form > 0),
  add column income_category text not null default '5' check (income_category in ('1','2','3','4a','5','6')),
  add column payer_condition text not null default 'withhold' check (payer_condition in ('withhold','forever','once','other')),
  add column payer_condition_note text,
  add column fund_gpf numeric(18,2) not null default 0,
  add column fund_sso numeric(18,2) not null default 0,
  add column fund_pvd numeric(18,2) not null default 0;

-- แก้รายละเอียดใบ (เฉพาะใบที่ยังใช้งานอยู่)
create function set_cert_details(p_id uuid, p_details jsonb) returns void language plpgsql as $$
declare c wht_certs;
begin
  select * into c from wht_certs where id = p_id for update;
  if not found or c.status <> 'active' then raise exception 'แก้ได้เฉพาะหนังสือรับรองที่ใช้งานอยู่'; end if;
  update wht_certs set
    book_no = coalesce(p_details->>'book_no', book_no),
    run_no = coalesce(p_details->>'run_no', run_no),
    seq_in_form = coalesce((p_details->>'seq_in_form')::int, seq_in_form),
    income_category = coalesce(p_details->>'income_category', income_category),
    payer_condition = coalesce(p_details->>'payer_condition', payer_condition),
    payer_condition_note = coalesce(p_details->>'payer_condition_note', payer_condition_note),
    fund_gpf = coalesce((p_details->>'fund_gpf')::numeric, fund_gpf),
    fund_sso = coalesce((p_details->>'fund_sso')::numeric, fund_sso),
    fund_pvd = coalesce((p_details->>'fund_pvd')::numeric, fund_pvd)
  where id = p_id;
end $$;

-- ข้อมูลสำหรับพิมพ์ 50 ทวิ + รายการข้อมูลที่ยังขาด (ใบที่ยกเลิกแล้วพิมพ์ไม่ได้)
create function wht_cert_data(p_id uuid) returns jsonb language plpgsql stable as $$
declare c wht_certs; e expenses; k contacts; p company_profile; v_missing text[] := '{}'; v_form text;
begin
  select * into c from wht_certs where id = p_id;
  if not found then raise exception 'ไม่พบหนังสือรับรอง'; end if;
  if c.status <> 'active' then raise exception 'หนังสือรับรองนี้ถูกยกเลิกแล้ว'; end if;
  select * into e from expenses where id = c.expense_id;
  select * into k from contacts where id = e.contact_id;
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
