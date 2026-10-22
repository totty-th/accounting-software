-- M4 ซื้อและหัก ณ ที่จ่าย: ค่าใช้จ่าย (EXP) → UV, จ่ายเงิน → PV, หนังสือรับรองหัก ณ ที่จ่าย (WT)
-- อ้างอิงสเปก PUR-02..06, PUR-08, WHT-01..04, WHT-06
-- ใบรับสินค้า (RI) ย้ายไป M5 เพราะบัญชีฝั่งเดบิตขึ้นกับบัญชีสินค้าคงเหลือ (D-01)

create table expenses (
  id           uuid primary key default gen_random_uuid(),
  exp_no       text not null unique,
  exp_date     date not null,
  contact_id   uuid not null references contacts(id),
  status       text not null default 'pending' check (status in ('pending','approved','paid','cancelled')),
  price_mode   text not null default 'exclusive' check (price_mode in ('exclusive','inclusive')),
  subtotal     numeric(18,2) not null default 0,
  vat          numeric(18,2) not null default 0,
  total        numeric(18,2) not null default 0,
  wht_total    numeric(18,2) not null default 0,
  uv_voucher_id uuid references journal_vouchers(id),
  pv_voucher_id uuid references journal_vouchers(id),
  paid_date    date,
  created_at   timestamptz not null default now()
);

create table expense_lines (
  expense_id   uuid not null references expenses(id),
  line_no      int not null,
  description  text not null,
  category     text,
  account_code text not null,
  qty          numeric(18,4) not null check (qty > 0),
  unit_price   numeric(18,2) not null check (unit_price >= 0),
  vat_rate     numeric(5,2) not null default 7,   -- 0 = ไม่มี VAT (ต่อบรรทัด)
  wht_rate     numeric(5,2) not null default 0,   -- 0 / 0.5 / 1 / 3 / 5 ... (ต่อบรรทัด)
  net          numeric(18,2) not null,
  vat          numeric(18,2) not null,
  wht          numeric(18,2) not null,
  primary key (expense_id, line_no)
);

-- แบบหัก ณ ที่จ่าย → บัญชีภาษีค้างจ่าย (ภ.ง.ด.3 ยังไม่ทราบบัญชี ต้องกำหนดก่อนใช้)
create table wht_forms (code text primary key, label text not null, account_code text);
insert into wht_forms values ('PND53','ภ.ง.ด.53 (นิติบุคคล)','27124'), ('PND3','ภ.ง.ด.3 (บุคคลธรรมดา)', null);

create table wht_certs (
  id          uuid primary key default gen_random_uuid(),
  cert_no     text not null unique,
  expense_id  uuid not null references expenses(id),
  form_code   text not null references wht_forms(code),
  income_type text,
  pay_date    date not null,
  base_amount numeric(18,2) not null,
  wht_amount  numeric(18,2) not null,
  status      text not null default 'active' check (status in ('active','cancelled')),
  created_at  timestamptz not null default now()
);

-- สร้างค่าใช้จ่าย → UV ทันที (PUR-02)
-- p_lines = [{"description":"..","account":"12612","qty":1,"unit_price":30000,"vat_rate":7,"wht_rate":0,"category":".."}]
create function create_expense(p_date date, p_contact uuid, p_lines jsonb, p_price_mode text default 'exclusive')
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid(); l jsonb; n int := 0;
        v_gross numeric; v_net numeric; v_vat numeric; v_wht numeric; v_vr numeric; v_wr numeric;
        t_net numeric := 0; t_vat numeric := 0; t_wht numeric := 0;
        v_lines jsonb := '[]'::jsonb; v uuid;
begin
  if p_lines is null or jsonb_array_length(p_lines) = 0 then raise exception 'ต้องมีรายการอย่างน้อย 1 บรรทัด'; end if;
  insert into expenses(id, exp_no, exp_date, contact_id, price_mode)
  values (v_id, next_doc_no('EXP', p_date, true), p_date, p_contact, p_price_mode);
  for l in select * from jsonb_array_elements(p_lines) loop
    n := n + 1;
    v_vr := coalesce((l->>'vat_rate')::numeric, 7); v_wr := coalesce((l->>'wht_rate')::numeric, 0);
    v_gross := round((l->>'qty')::numeric * (l->>'unit_price')::numeric, 2);
    if p_price_mode = 'exclusive' then
      v_net := v_gross; v_vat := round(v_net * v_vr / 100, 2);
    else
      v_net := round(v_gross * 100 / (100 + v_vr), 2); v_vat := v_gross - v_net;
    end if;
    v_wht := round(v_net * v_wr / 100, 2);   -- หักจากมูลค่าก่อน VAT
    insert into expense_lines values (v_id, n, l->>'description', l->>'category', l->>'account',
      (l->>'qty')::numeric, (l->>'unit_price')::numeric, v_vr, v_wr, v_net, v_vat, v_wht);
    t_net := t_net + v_net; t_vat := t_vat + v_vat; t_wht := t_wht + v_wht;
    v_lines := v_lines || jsonb_build_object('account', l->>'account', 'debit', v_net);
  end loop;
  if t_vat > 0 then v_lines := v_lines || jsonb_build_object('account','17113','debit',t_vat); end if;
  v_lines := v_lines || jsonb_build_object('account','21399','credit', t_net + t_vat);
  v := post_voucher('UV', p_date, null, 'EXP', v_id::text, v_lines);
  update expenses set subtotal = t_net, vat = t_vat, total = t_net + t_vat, wht_total = t_wht, uv_voucher_id = v
   where id = v_id;
  return v_id;
end $$;

-- อนุมัติ: ไม่มีรายการบัญชี
create function approve_expense(p_id uuid) returns void language plpgsql as $$
begin
  update expenses set status = 'approved' where id = p_id and status = 'pending';
  if not found then raise exception 'อนุมัติได้เฉพาะค่าใช้จ่ายที่รอดำเนินการ'; end if;
end $$;

-- จ่ายเงิน: PV Dr 21399 / Cr 27124 (WHT) / Cr เงินสด-ธนาคารสุทธิ + สร้างหนังสือรับรองอัตโนมัติ (WHT-02/03)
create function pay_expense(p_id uuid, p_date date, p_pay_account text default '11112',
  p_create_cert boolean default true, p_form text default 'PND53', p_income_type text default null)
returns uuid language plpgsql as $$
declare e expenses; f wht_forms; v_lines jsonb; v uuid;
begin
  select * into e from expenses where id = p_id for update;
  if not found or e.status not in ('pending','approved') then
    raise exception 'จ่ายเงินได้เฉพาะค่าใช้จ่ายที่รอดำเนินการหรืออนุมัติแล้ว';
  end if;
  v_lines := jsonb_build_array(jsonb_build_object('account','21399','debit',e.total));
  if e.wht_total > 0 then
    select * into f from wht_forms where code = p_form;
    if not found or f.account_code is null then
      raise exception 'ยังไม่ได้กำหนดบัญชีภาษีหัก ณ ที่จ่ายของแบบ %', p_form;
    end if;
    v_lines := v_lines || jsonb_build_object('account', f.account_code, 'credit', e.wht_total);
  end if;
  v_lines := v_lines || jsonb_build_object('account', p_pay_account, 'credit', e.total - e.wht_total);
  v := post_voucher('PV', p_date, null, 'EXP-PAY', p_id::text, v_lines);
  update expenses set status = 'paid', pv_voucher_id = v, paid_date = p_date where id = p_id;
  if e.wht_total > 0 and p_create_cert then
    insert into wht_certs(cert_no, expense_id, form_code, income_type, pay_date, base_amount, wht_amount)
    select next_doc_no('WT', p_date, true), p_id, p_form, p_income_type, p_date,
           (select sum(net) from expense_lines where expense_id = p_id and wht > 0), e.wht_total;
  end if;
  return v;
end $$;

create function cancel_wht_cert(p_id uuid) returns void language plpgsql as $$
begin
  update wht_certs set status = 'cancelled' where id = p_id and status = 'active';
  if not found then raise exception 'ไม่พบหนังสือรับรองที่ใช้งานอยู่'; end if;
end $$;

-- รีเซ็ต: อนุมัติ → รอดำเนินการ · ชำระแล้ว → รอดำเนินการ (ข้ามอนุมัติ) PV ได้ -R และหนังสือรับรองถูกยกเลิก (PUR-05/WHT-04)
create function reset_expense(p_id uuid) returns void language plpgsql as $$
declare e expenses;
begin
  select * into e from expenses where id = p_id for update;
  if not found or e.status not in ('approved','paid') then raise exception 'รีเซ็ตได้เฉพาะค่าใช้จ่ายที่อนุมัติหรือชำระแล้ว'; end if;
  if e.status = 'paid' then
    perform reverse_voucher(e.pv_voucher_id);
    update wht_certs set status = 'cancelled' where expense_id = p_id and status = 'active';
    update expenses set pv_voucher_id = null, paid_date = null where id = p_id;
  end if;
  update expenses set status = 'pending' where id = p_id;
end $$;

-- ยกเลิก: UV (และ PV ถ้าจ่ายแล้ว) ได้ -R ทั้งคู่ (PUR-06)
create function cancel_expense(p_id uuid) returns void language plpgsql as $$
declare e expenses;
begin
  select * into e from expenses where id = p_id for update;
  if not found or e.status = 'cancelled' then raise exception 'ไม่พบค่าใช้จ่ายหรือถูกยกเลิกแล้ว'; end if;
  if e.pv_voucher_id is not null then perform reverse_voucher(e.pv_voucher_id); end if;
  perform reverse_voucher(e.uv_voucher_id);
  update wht_certs set status = 'cancelled' where expense_id = p_id and status = 'active';
  update expenses set status = 'cancelled' where id = p_id;
end $$;
