-- M23 แก้ไขเอกสารขายที่บันทึกแล้ว (ตามต้นแบบ FA — REA ข้อ 1, เจ้าของระบบเลือกแบบ B 25-10-2026)
-- หลักการเดิม "รายการบัญชีแก้/ลบไม่ได้" ผ่อนเป็น: แก้ได้ "เฉพาะผ่าน overwrite_voucher()" เท่านั้น
--   · ใบสำคัญเดิมถูกแก้ทับที่เลขเดิม (ไม่มี -R) · เก็บค่าก่อน-หลังทุกครั้งใน voucher_edits และ doc_events('edit') (FA ไม่เก็บ ของเราเก็บ)
--   · ตรวจล็อกงวดทั้งวันที่เดิมและวันที่ใหม่
-- INV/CA แก้ได้ทุกช่อง "ถ้ายังไม่มีเอกสารอื่นผูก" (ใบเสร็จ/ใบวางบิล/CN/DN/ใบส่งของ/ขายสดที่เก็บเงินแล้ว/ใบมัดจำ);
--   ถ้ามีเอกสารผูก = แก้ได้เฉพาะข้อมูลทั่วไป (เลขอ้างอิง/รายละเอียด/โปรเจ็ค/หมายเหตุ/โน้ตภายใน) ตาม FA
-- สต็อก: คืนที่ตัดไปเดิมแล้วตัดใหม่ตามรายการใหม่ (ผลสุทธิ = ปรับตามส่วนต่างจำนวน เหมือน FA) · QT ต้นทาง: คำนวณสถานะใหม่ ไม่กันยอดเกิน (FA ไม่กัน)

create table voucher_edits (
  id bigserial primary key,
  voucher_id uuid not null references journal_vouchers(id),
  edited_at timestamptz not null default now(),
  actor_id uuid references app_users(id),
  before jsonb not null,
  after jsonb not null
);
create index on voucher_edits (voucher_id, id);

create or replace function forbid_change() returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('app.voucher_edit', true), '') = '1' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  raise exception 'รายการบัญชีแก้ไขหรือลบไม่ได้ ให้ใช้ใบกลับรายการ (-R)';
end $$;

alter table doc_events drop constraint doc_events_event_check;
alter table doc_events add constraint doc_events_event_check
  check (event in ('created','status','note','file_added','file_removed','wht','delivery','billing','edit'));

create or replace function voucher_snapshot(p_id uuid) returns jsonb language sql stable as $$
  select jsonb_build_object('no', v.voucher_no, 'date', v.voucher_date,
    'lines', coalesce((select jsonb_agg(jsonb_build_object('account', a.code, 'debit', l.debit, 'credit', l.credit) order by l.line_no)
                         from journal_lines l join accounts a on a.id = l.account_id where l.voucher_id = v.id), '[]'::jsonb))
  from journal_vouchers v where v.id = p_id
$$;

-- แก้ทับใบสำคัญที่เลขเดิม (ใช้จากฟังก์ชันแก้เอกสารเท่านั้น)
create or replace function overwrite_voucher(p_id uuid, p_date date, p_lines jsonb) returns void language plpgsql as $$
declare o journal_vouchers; l jsonb; n int := 0; v_acc uuid; v_before jsonb; d numeric; c numeric;
begin
  select * into o from journal_vouchers where id = p_id for update;
  if not found then raise exception 'ไม่พบใบสำคัญ'; end if;
  if o.reverses_id is not null or exists (select 1 from journal_vouchers where reverses_id = o.id) then
    raise exception 'ใบสำคัญ % ถูกกลับรายการแล้ว แก้ไม่ได้', o.voucher_no;
  end if;
  if p_lines is null or jsonb_array_length(p_lines) < 2 then raise exception 'ใบสำคัญต้องมีอย่างน้อย 2 รายการ'; end if;
  perform assert_period_open(o.voucher_date);
  perform assert_period_open(p_date);
  v_before := voucher_snapshot(p_id);
  perform set_config('app.voucher_edit', '1', true);
  delete from journal_lines where voucher_id = p_id;
  update journal_vouchers set voucher_date = p_date where id = p_id;
  for l in select * from jsonb_array_elements(p_lines) loop
    select id into v_acc from accounts where code = l->>'account' and is_active;
    if v_acc is null then raise exception 'ไม่พบบัญชี %', l->>'account'; end if;
    d := coalesce((l->>'debit')::numeric, 0); c := coalesce((l->>'credit')::numeric, 0); n := n + 1;
    insert into journal_lines(voucher_id, line_no, account_id, debit, credit) values (p_id, n, v_acc, d, c);
  end loop;
  perform set_config('app.voucher_edit', '', true);
  insert into voucher_edits(voucher_id, actor_id, before, after) values (p_id, doc_event_actor(), v_before, voucher_snapshot(p_id));
end $$;

drop function create_invoice_full(jsonb, jsonb, uuid, text);
create or replace function create_invoice_full(p_header jsonb, p_lines jsonb, p_ref uuid default null, p_type text default 'INV', p_edit uuid default null) returns uuid language plpgsql as $$
declare v_id uuid := coalesce(p_edit, gen_random_uuid()); v_old sales_docs; v_oldv uuid; h jsonb := coalesce(p_header, '{}'); l jsonb; n int := 0; pr products;
        v_date date := (h->>'date')::date; v_mode text := coalesce(nullif(h->>'price_mode',''), 'exclusive');
        v_term text := coalesce(nullif(h->>'term_mode',''), 'credit');
        v_cd int := coalesce(nullif(h->>'credit_days','')::int, 0);
        v_dt text; v_dv numeric; v_wr numeric; v_wht numeric; v_qty numeric; v_price numeric; v_desc text; v_pid uuid; v_detail text; v_auto boolean;
        v_wh uuid := nullif(h->>'warehouse_id','')::uuid;
        c record; v_amt numeric;
        t_net numeric := 0; t_vat numeric := 0; t_disc numeric := 0; t_ex numeric := 0; t_wht numeric := 0; t_goods numeric := 0; t_serv numeric := 0;
        v_total numeric; v_rev jsonb := '[]'::jsonb; v_voucher uuid;
begin
  if p_type not in ('INV','CA') then raise exception 'ประเภทเอกสาร % ไม่รองรับ', p_type; end if;
  if p_lines is null or jsonb_array_length(p_lines) = 0 then raise exception 'ต้องมีรายการอย่างน้อย 1 บรรทัด'; end if;
  if v_mode not in ('exclusive','inclusive') then raise exception 'ราคาสินค้า % ไม่ถูกต้อง', v_mode; end if;
  if v_term not in ('credit','credit_nodate') then raise exception 'เงื่อนไขชำระ % ไม่ถูกต้อง', v_term; end if;
  if v_date is null then raise exception 'ต้องระบุวันที่'; end if;
  if nullif(h->>'contact','') is null then raise exception 'ต้องเลือกลูกค้า'; end if;
  if nullif(h->>'due_date','') is not null then v_cd := (h->>'due_date')::date - v_date; end if;   -- แก้วันครบกำหนดตรง ๆ = เครดิตเปลี่ยนตาม (FA)
  if v_cd < 0 then raise exception 'วันครบกำหนดต้องไม่ก่อนวันที่ของเอกสาร'; end if;

  if p_type = 'CA' then v_term := 'credit'; v_cd := 0; end if;   -- ขายสด ไม่มีเครดิต/ครบกำหนด
  if p_edit is null then
  insert into sales_docs(id, doc_type, doc_no, doc_date, contact_id, status, ref_doc_id)
  values (v_id, p_type, next_doc_no(p_type, v_date, true), v_date, (h->>'contact')::uuid,
          case p_type when 'CA' then 'pending_collect' else 'awaiting_payment' end, p_ref);
  else   -- แก้เอกสารเดิม (M23): คงเลขที่เอกสาร/ใบสำคัญเดิม คืนสต็อกเดิมแล้วตัดใหม่ตามรายการใหม่
    select * into v_old from sales_docs where id = p_edit for update;
    v_oldv := v_old.voucher_id;
    perform stock_return_for_doc(p_edit);
    delete from sales_doc_lines where doc_id = p_edit;
    update sales_docs set doc_date = v_date, contact_id = (h->>'contact')::uuid where id = p_edit;
  end if;

  for l in select * from jsonb_array_elements(p_lines) loop
    n := n + 1;
    v_auto := false; v_pid := nullif(l->>'product_id','')::uuid; v_desc := nullif(btrim(coalesce(l->>'description','')), '');
    if v_pid is not null then
      select * into pr from products where id = v_pid;
      if not found then raise exception 'ไม่พบสินค้า (บรรทัด %)', n; end if;
      v_desc := coalesce(v_desc, pr.name);
    end if;
    if v_desc is null then raise exception 'บรรทัด % ต้องมีรายการหรือรายละเอียด', n; end if;
    v_detail := nullif(btrim(coalesce(l->>'detail','')), '');
    if v_pid is null then   -- ตาม FA: ชื่อที่พิมพ์เองถูกสร้างเป็นสินค้าประเภทบริการ (ใช้ตัวเดิมถ้าชื่อซ้ำ)
      select * into pr from products where lower(name) = lower(v_desc) and is_active order by code limit 1;
      if found then v_pid := pr.id;
      else
        insert into products(code, name, kind, sale_price) values ('NEW-' || substr(md5(random()::text || clock_timestamp()::text), 1, 8), v_desc, 'service',
          coalesce(nullif(l->>'unit_price','')::numeric, 0)) returning * into pr;
        v_pid := pr.id; v_auto := true;
      end if;
    end if;
    v_qty := (l->>'qty')::numeric; v_price := coalesce(nullif(l->>'unit_price','')::numeric, 0);
    if v_qty is null or v_qty <= 0 then raise exception 'จำนวนต้องมากกว่า 0 (บรรทัด %)', n; end if;
    if v_price < 0 then raise exception 'ราคาต้องไม่ติดลบ (บรรทัด %)', n; end if;
    v_dt := coalesce(nullif(l->>'discount_type',''), 'percent'); v_dv := coalesce(nullif(l->>'discount_value','')::numeric, 0);
    v_wr := coalesce(nullif(l->>'wht_rate','')::numeric, 0);
    if v_wr < 0 or v_wr > 100 then raise exception 'อัตราหัก ณ ที่จ่ายไม่ถูกต้อง (บรรทัด %)', n; end if;
    select * into c from purchase_line_calc(v_qty, v_price, v_dt, v_dv, coalesce(nullif(l->>'vat',''), '7'), v_mode);
    v_wht := round(c.v_net * v_wr / 100, 2);
    v_amt := case when v_mode = 'exclusive' or c.v_exempt or c.v_rate = 0 then c.v_net else c.v_net + c.v_vat end;
    insert into sales_doc_lines(doc_id, line_no, description, detail, item_kind, qty, unit_price, amount, product_id, warehouse_id,
        unit, discount_type, discount_value, discount, vat_rate, vat_exempt, wht_rate, wht, src_line_no)
    values (v_id, n, v_desc, v_detail, case when pr.kind = 'service' then 'service' else 'goods' end, v_qty, v_price, v_amt, v_pid,
        coalesce(nullif(l->>'warehouse_id','')::uuid, v_wh),
        coalesce(nullif(l->>'unit',''), case when not v_auto then pr.base_unit end), v_dt, v_dv, c.v_disc, c.v_rate, c.v_exempt, v_wr, v_wht, nullif(l->>'src_line_no','')::int);
    if pr.kind = 'service' then t_serv := t_serv + c.v_net; else t_goods := t_goods + c.v_net; end if;
    pr := null;
    t_net := t_net + c.v_net; t_vat := t_vat + c.v_vat; t_disc := t_disc + c.v_disc; t_wht := t_wht + v_wht;
    if c.v_exempt then t_ex := t_ex + c.v_net; end if;
  end loop;
  v_total := t_net + t_vat;
  if v_total <= 0 then raise exception 'ยอดรวมต้องมากกว่า 0'; end if;   -- FA บันทึกยอด 0.00 ได้ แต่เราไม่ลงรายการบัญชีศูนย์บาท

  update sales_docs set price_mode = v_mode, vat_rate = 7,
      term_mode = v_term, credit_days = v_cd, due_date = case when p_type = 'INV' and v_term = 'credit' then v_date + v_cd end,
      salesperson = nullif(h->>'salesperson',''), project = nullif(h->>'project',''), ref_no = nullif(h->>'ref_no',''),
      description = nullif(h->>'description',''), warehouse_id = v_wh,
      show_signature = coalesce((h->>'show_signature')::boolean, true), note = nullif(h->>'note',''),
      internal_note = nullif(h->>'internal_note',''),
      subtotal = t_net, vat = t_vat, total = v_total, discount_total = t_disc, exempt_base = t_ex, wht_total = t_wht
    where id = v_id;

  if t_goods > 0 then v_rev := v_rev || jsonb_build_object('account','41110','credit',t_goods); end if;
  if t_serv  > 0 then v_rev := v_rev || jsonb_build_object('account','41210','credit',t_serv);  end if;
  if t_vat   > 0 then v_rev := v_rev || jsonb_build_object('account','27111','credit',t_vat);   end if;
  if p_edit is null then
    v_voucher := post_voucher(case p_type when 'CA' then 'RV' else 'SV' end, v_date, null, p_type, v_id::text,
      jsonb_build_array(jsonb_build_object('account', case p_type when 'CA' then '11319' else '11311' end, 'debit', v_total)) || v_rev);
    update sales_docs set voucher_id = v_voucher where id = v_id;
  else
    perform overwrite_voucher(v_oldv, v_date,
      jsonb_build_array(jsonb_build_object('account', case p_type when 'CA' then '11319' else '11311' end, 'debit', v_total)) || v_rev);
  end if;
  perform stock_issue_for_doc(v_id);
  if p_edit is not null and v_old.ref_doc_id is not null then perform quotation_refresh(v_old.ref_doc_id); end if;
  return v_id;
end $$;

-- ภาพรวมเอกสารสำหรับประวัติก่อน-หลัง
create or replace function sales_doc_snapshot(p_id uuid) returns jsonb language sql stable as $$
  select jsonb_build_object('date', d.doc_date, 'contact', coalesce(c.business_name, c.contact_name), 'credit_days', d.credit_days,
    'salesperson', d.salesperson, 'ref_no', d.ref_no, 'project', d.project, 'description', d.description, 'note', d.note, 'internal_note', d.internal_note,
    'subtotal', d.subtotal, 'vat', d.vat, 'total', d.total,
    'lines', coalesce((select jsonb_agg(jsonb_build_object('description', l.description, 'qty', l.qty, 'unit_price', l.unit_price,
        'discount', l.discount, 'vat_rate', l.vat_rate, 'amount', l.amount) order by l.line_no) from sales_doc_lines l where l.doc_id = d.id), '[]'::jsonb))
  from sales_docs d join contacts c on c.id = d.contact_id where d.id = p_id
$$;

-- แก้ได้ทุกช่องหรือไม่ (ยังไม่มีเอกสารอื่นผูก) — ใช้ทั้งฟังก์ชันและหน้าจอ
create or replace function sales_doc_fully_editable(p_id uuid) returns boolean language plpgsql stable as $$
declare d sales_docs;
begin
  select * into d from sales_docs where id = p_id;
  if not found or d.status = 'cancelled' or d.doc_type not in ('INV','CA') or d.is_deposit or coalesce(d.deposit_net, 0) > 0 then return false; end if;
  if d.doc_type = 'CA' and d.status <> 'pending_collect' then return false; end if;
  if sales_doc_has_active_receipt(p_id) then return false; end if;
  if exists (select 1 from sales_docs x where x.ref_doc_id = p_id and x.status <> 'cancelled') then return false; end if;
  if exists (select 1 from billing_note_items bi join sales_docs b on b.id = bi.billing_id where bi.invoice_id = p_id and b.status <> 'cancelled') then return false; end if;
  return true;
end $$;

create or replace function update_sales_doc(p_id uuid, p_header jsonb, p_lines jsonb) returns void language plpgsql as $$
declare d sales_docs; h jsonb := coalesce(p_header, '{}'); v_before jsonb; v_after jsonb; v_full boolean;
begin
  select * into d from sales_docs where id = p_id for update;
  if not found then raise exception 'ไม่พบเอกสาร'; end if;
  if d.doc_type not in ('INV','CA') then raise exception 'แก้ไขเอกสารประเภท % ยังไม่รองรับ', d.doc_type; end if;
  if d.status = 'cancelled' then raise exception 'เอกสารถูกยกเลิกแล้ว แก้ไขไม่ได้'; end if;
  v_before := sales_doc_snapshot(p_id);
  v_full := sales_doc_fully_editable(p_id);
  if v_full then
    perform create_invoice_full(h, p_lines, null, d.doc_type, p_id);
  else   -- ล็อก: แก้ได้เฉพาะข้อมูลทั่วไป ตาม FA
    update sales_docs set ref_no = nullif(h->>'ref_no',''), description = nullif(h->>'description',''), project = nullif(h->>'project',''),
        note = nullif(h->>'note',''), internal_note = nullif(h->>'internal_note','') where id = p_id;
  end if;
  v_after := sales_doc_snapshot(p_id);
  if v_before = v_after then raise exception 'ไม่พบการเปลี่ยนแปลงข้อมูลในเอกสาร'; end if;
  insert into doc_events(doc_id, event, detail, actor_id)
  values (p_id, 'edit', jsonb_build_object('mode', case when v_full then 'full' else 'info' end, 'before', v_before, 'after', v_after)::text, doc_event_actor());
end $$;
