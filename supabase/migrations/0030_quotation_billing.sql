-- M18.11 เรียกเก็บเงินจากใบเสนอราคา (REA FlowAccount 24-10-2026 รอบ 5) + ผู้ใช้เลือก: ข้ามอนุมัติได้เหมือน FA, แบ่งจ่ายครบ,
-- ดำเนินการแล้วกดเอง, สร้างใบกำกับภาษี/ใบเสร็จเงินสดและใบวางบิลจาก QT (ไม่ทำใบสั่งซื้อจาก QT)
-- กติกา: QT ไม่ลงบัญชี — ลงบัญชีที่ใบแจ้งหนี้/ขายสดที่ออกจาก QT เท่านั้น · ยอดเรียกเก็บ = ผลรวมใบแจ้งหนี้/ขายสดที่ยังไม่ยกเลิก (ไม่รวมมัดจำ)
-- สถานะ QT คำนวณใหม่เสมอหลังออก/ยกเลิกเอกสาร: ครบยอด/ปิดยอดมือ/มีใบวางบิล = converted · เรียกเก็บบางส่วน = partial · ไม่เหลือเอกสาร = approved
-- ข้อสันนิษฐานของเรา (FA ยังไม่ได้ทดสอบ): ยกเลิกใบแจ้งหนี้ที่ออกจาก QT แล้ว QT กลับเป็น "อนุมัติแล้ว"; แบ่งจ่ายแบบเปอร์เซ็นต์/ยอดเงิน
-- ปรับจำนวนสินค้าตามสัดส่วน (ปัดทศนิยม 4 ตำแหน่ง) เพื่อให้สต็อกตัดตามส่วนที่เรียกเก็บ; แบ่งจ่ายด้วยยอดเงินคิดเป็นสัดส่วนของยอดรวมใบเสนอราคา

alter table sales_doc_lines add column src_line_no int;   -- บรรทัดของใบเสนอราคาต้นทาง (ใช้คำนวณจำนวนคงเหลือ)

create table quotation_closeouts (
  id         bigserial primary key,
  qt_id      uuid not null references sales_docs(id),
  amount     numeric(18,2) not null check (amount > 0),   -- ยอดคงเหลือที่ปิดโดยไม่ออกเอกสาร
  created_at timestamptz not null default now(),
  actor_id   uuid references app_users(id),
  voided_at  timestamptz
);
create index on quotation_closeouts (qt_id);

alter table doc_events drop constraint doc_events_event_check;
alter table doc_events add constraint doc_events_event_check
  check (event in ('created','status','note','file_added','file_removed','wht','delivery','billing'));

drop function create_invoice_full(jsonb, jsonb, uuid);

create or replace function create_invoice_full(p_header jsonb, p_lines jsonb, p_ref uuid default null, p_type text default 'INV') returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid(); h jsonb := coalesce(p_header, '{}'); l jsonb; n int := 0; pr products;
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
  insert into sales_docs(id, doc_type, doc_no, doc_date, contact_id, status, ref_doc_id)
  values (v_id, p_type, next_doc_no(p_type, v_date, true), v_date, (h->>'contact')::uuid,
          case p_type when 'CA' then 'pending_collect' else 'awaiting_payment' end, p_ref);

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
  v_voucher := post_voucher(case p_type when 'CA' then 'RV' else 'SV' end, v_date, null, p_type, v_id::text,
    jsonb_build_array(jsonb_build_object('account', case p_type when 'CA' then '11319' else '11311' end, 'debit', v_total)) || v_rev);
  update sales_docs set voucher_id = v_voucher where id = v_id;
  perform stock_issue_for_doc(v_id);
  return v_id;
end $$;


-- ยอดเรียกเก็บแล้ว = ใบแจ้งหนี้/ขายสดที่ยังไม่ยกเลิก (ไม่รวมใบมัดจำ)
create or replace function quotation_billed(p_qt uuid) returns numeric language sql stable as $$
  select coalesce(sum(total), 0) from sales_docs
   where ref_doc_id = p_qt and doc_type in ('INV','CA') and status <> 'cancelled' and not is_deposit
$$;

-- คำนวณสถานะ QT ใหม่จากเอกสารที่ผูกอยู่
create or replace function quotation_refresh(p_qt uuid) returns void language plpgsql as $$
declare q sales_docs; v_billed numeric; v_closed numeric; v_bl boolean; v_new text;
begin
  select * into q from sales_docs where id = p_qt and doc_type = 'QT' for update;
  if not found or q.status in ('rejected','cancelled','deposit_paid') then return; end if;
  v_billed := quotation_billed(p_qt);
  select coalesce(sum(amount), 0) into v_closed from quotation_closeouts where qt_id = p_qt and voided_at is null;
  v_bl := exists (select 1 from sales_docs where ref_doc_id = p_qt and doc_type = 'BL' and status <> 'cancelled');
  v_new := case when v_closed > 0 or v_bl or v_billed >= q.total - 0.005 then 'converted'
                when v_billed > 0 then 'partial'
                when q.status in ('partial','converted') then 'approved'
                else q.status end;
  if v_new <> q.status then update sales_docs set status = v_new where id = p_qt; end if;
end $$;

-- ยกเลิกใบแจ้งหนี้/ขายสด/ใบวางบิลที่ออกจาก QT → คำนวณสถานะ QT ใหม่
create or replace function trg_quotation_refresh() returns trigger language plpgsql as $$
begin
  if exists (select 1 from sales_docs where id = new.ref_doc_id and doc_type = 'QT') then perform quotation_refresh(new.ref_doc_id); end if;
  return null;
end $$;
create trigger sales_docs_qt_refresh after update of status on sales_docs
  for each row when (new.status = 'cancelled' and old.status <> 'cancelled' and new.ref_doc_id is not null and new.doc_type in ('INV','CA','BL'))
  execute function trg_quotation_refresh();

-- สรุปการเรียกเก็บเงินของ QT (ใช้ทั้งหน้าจอและฟอร์มแบ่งจ่าย)
create or replace function quotation_billing_summary(p_qt uuid) returns jsonb language plpgsql stable as $$
declare q sales_docs; v_billed numeric; v_closed numeric;
begin
  select * into q from sales_docs where id = p_qt and doc_type = 'QT';
  if not found then raise exception 'ไม่พบใบเสนอราคา'; end if;
  v_billed := quotation_billed(p_qt);
  select coalesce(sum(amount), 0) into v_closed from quotation_closeouts where qt_id = p_qt and voided_at is null;
  return jsonb_build_object('total', q.total, 'billed', v_billed, 'closed', v_closed,
    'remaining', greatest(q.total - v_billed - v_closed, 0),
    'percent', case when q.total > 0 then round((v_billed + v_closed) * 100 / q.total, 2) else 0 end,
    'docs', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'doc_no', d.doc_no, 'doc_type', d.doc_type, 'doc_date', d.doc_date,
        'subtotal', d.subtotal, 'total', d.total, 'status', d.status, 'is_deposit', d.is_deposit) order by d.doc_date, d.doc_no)
        from sales_docs d where d.ref_doc_id = p_qt and d.doc_type in ('INV','CA','BL')), '[]'::jsonb),
    'closeouts', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'amount', c.amount, 'at', c.created_at) order by c.id)
        from quotation_closeouts c where c.qt_id = p_qt and c.voided_at is null), '[]'::jsonb),
    'lines', coalesce((select jsonb_agg(jsonb_build_object('line_no', l.line_no, 'description', l.description, 'unit', l.unit, 'qty', l.qty,
        'billed_qty', b.qty_billed, 'remaining_qty', greatest(l.qty - b.qty_billed, 0), 'unit_price', l.unit_price) order by l.line_no)
        from sales_doc_lines l
        cross join lateral (select coalesce(sum(c.qty), 0) as qty_billed from sales_doc_lines c join sales_docs d on d.id = c.doc_id
           where d.ref_doc_id = p_qt and d.doc_type in ('INV','CA') and d.status <> 'cancelled' and not d.is_deposit and c.src_line_no = l.line_no) b
        where l.doc_id = p_qt), '[]'::jsonb));
end $$;

-- เรียกเก็บเงินจาก QT: p_kind INV | CA | BL · p_mode all(ทั้งหมดที่เหลือ) | percent | amount | qty (ระบุจำนวนต่อบรรทัดใน p_qtys {"1":2,"2":1})
create or replace function quotation_bill(p_qt uuid, p_kind text, p_date date, p_mode text default 'all', p_value numeric default null,
                                          p_qtys jsonb default null) returns uuid language plpgsql as $$
declare q sales_docs; r record; v_lines jsonb := '[]'::jsonb; v_new numeric; v_ratio numeric; v_dv numeric; v_id uuid; v_hdr jsonb;
begin
  select * into q from sales_docs where id = p_qt and doc_type = 'QT' for update;
  if not found then raise exception 'ไม่พบใบเสนอราคา'; end if;
  if q.status not in ('pending_approval','approved','partial') then
    raise exception 'สร้างเอกสารต่อได้เฉพาะใบเสนอราคาที่รออนุมัติ อนุมัติแล้ว หรือแบ่งจ่าย';
  end if;
  if p_kind not in ('INV','CA','BL') then raise exception 'ชนิดเอกสาร % ไม่ถูกต้อง', p_kind; end if;

  if p_kind = 'BL' then   -- ใบวางบิลจาก QT: คัดลอกรายการทั้งใบ ไม่ลงบัญชี ไม่นับเป็นยอดเรียกเก็บ (ตาม FA: QT กลายเป็นดำเนินการแล้ว)
    if q.status = 'partial' then raise exception 'ใบเสนอราคาที่แบ่งจ่ายแล้วสร้างใบวางบิลไม่ได้'; end if;
    if exists (select 1 from sales_docs where ref_doc_id = p_qt and doc_type = 'BL' and status <> 'cancelled') then
      raise exception 'ใบเสนอราคานี้สร้างใบวางบิลแล้ว';
    end if;
    v_id := gen_random_uuid();
    insert into sales_docs(id, doc_type, doc_no, doc_date, contact_id, status, ref_doc_id, price_mode, vat_rate, subtotal, vat, total,
                           term_mode, credit_days, due_date, salesperson, project, ref_no, description, note, show_signature, discount_total, exempt_base)
    values (v_id, 'BL', next_doc_no('BL', p_date, true), p_date, q.contact_id, 'billed', p_qt, q.price_mode, q.vat_rate, q.subtotal, q.vat, q.total,
            case when q.term_mode = 'cash' then 'credit' else q.term_mode end, case when q.term_mode = 'cash' then 0 else q.credit_days end,
            case when q.term_mode = 'credit' then p_date + q.credit_days end,
            q.salesperson, q.project, q.ref_no, q.description, q.note, q.show_signature, q.discount_total, q.exempt_base);
    insert into sales_doc_lines(doc_id, line_no, description, detail, item_kind, qty, unit_price, amount, product_id, warehouse_id, unit,
                                discount_type, discount_value, discount, vat_rate, vat_exempt, wht_rate, wht, src_line_no)
      select v_id, line_no, description, detail, item_kind, qty, unit_price, amount, product_id, warehouse_id, unit,
             discount_type, discount_value, discount, vat_rate, vat_exempt, wht_rate, wht, line_no from sales_doc_lines where doc_id = p_qt;
    perform quotation_refresh(p_qt);
    return v_id;
  end if;

  if p_mode not in ('all','percent','amount','qty') then raise exception 'วิธีแบ่ง % ไม่ถูกต้อง', p_mode; end if;
  if p_mode in ('percent','amount') then
    if p_value is null or p_value <= 0 then raise exception 'ระบุ%ที่ต้องการเรียกเก็บ', case p_mode when 'percent' then 'เปอร์เซ็นต์' else 'จำนวนเงิน' end; end if;
    v_ratio := case p_mode when 'percent' then p_value / 100 else p_value / nullif(q.total, 0) end;
    if v_ratio > 1 then raise exception '%เกินยอดใบเสนอราคา', case p_mode when 'percent' then 'เปอร์เซ็นต์' else 'จำนวนเงิน' end; end if;
  end if;
  if p_mode = 'qty' and p_qtys is null then raise exception 'ระบุจำนวนสินค้าที่ต้องการเรียกเก็บ'; end if;

  for r in select l.*, l.qty - coalesce((select sum(c.qty) from sales_doc_lines c join sales_docs d on d.id = c.doc_id
              where d.ref_doc_id = p_qt and d.doc_type in ('INV','CA') and d.status <> 'cancelled' and not d.is_deposit
                and c.src_line_no = l.line_no), 0) as rem
           from sales_doc_lines l where l.doc_id = p_qt order by l.line_no loop
    v_new := case p_mode when 'all' then r.rem
                         when 'qty' then coalesce(nullif(p_qtys->>(r.line_no::text), '')::numeric, 0)
                         else least(r.rem, round(r.qty * v_ratio, 4)) end;
    if v_new < 0 then raise exception 'จำนวนต้องไม่ติดลบ (บรรทัด %)', r.line_no; end if;
    if p_mode = 'qty' and v_new > r.rem then raise exception 'บรรทัด % เกินจำนวนคงเหลือ (เหลือ %)', r.line_no, trim_scale(r.rem); end if;
    if v_new <= 0 then continue; end if;
    v_dv := case when r.discount_type = 'amount' then round(r.discount_value * v_new / r.qty, 2) else r.discount_value end;   -- ส่วนลดเป็นบาท ปรับตามสัดส่วนจำนวน
    v_lines := v_lines || jsonb_build_object('product_id', r.product_id, 'description', r.description, 'detail', r.detail, 'unit', r.unit,
        'qty', v_new, 'unit_price', r.unit_price, 'discount_type', r.discount_type, 'discount_value', v_dv,
        'warehouse_id', coalesce(r.warehouse_id, q.warehouse_id),
        'vat', case when r.vat_exempt then 'exempt' else trim_scale(coalesce(r.vat_rate, 7))::text end, 'wht_rate', r.wht_rate, 'src_line_no', r.line_no);
  end loop;
  if jsonb_array_length(v_lines) = 0 then raise exception 'ไม่มีรายการที่จะเรียกเก็บ (ไม่เหลือจำนวน หรือยังไม่ได้ระบุจำนวน)'; end if;

  v_hdr := jsonb_build_object('date', p_date, 'contact', q.contact_id,
    'term_mode', case when q.term_mode = 'credit_nodate' then 'credit_nodate' else 'credit' end,
    'credit_days', case when q.term_mode = 'cash' then 0 else q.credit_days end,
    'salesperson', q.salesperson, 'project', q.project, 'ref_no', q.ref_no, 'description', q.description,
    'price_mode', q.price_mode, 'warehouse_id', q.warehouse_id, 'show_signature', q.show_signature, 'note', q.note,
    'internal_note', q.internal_note);
  v_id := create_invoice_full(v_hdr, v_lines, p_qt, p_kind);
  update sales_docs set delivery_mode = q.delivery_mode, ship_name = q.ship_name, ship_address = q.ship_address, ship_phone = q.ship_phone,
      carrier = q.carrier, delivery_note = q.delivery_note where id = v_id;   -- ข้อมูลจัดส่งตามไปกับเอกสาร
  perform quotation_refresh(p_qt);
  return v_id;
end $$;

-- สร้างใบแจ้งหนี้ทั้งใบ (ที่เหลือทั้งหมด) — คงชื่อเดิมไว้ให้โค้ดเก่าใช้ต่อ
create or replace function quotation_to_invoice(p_qt uuid, p_date date) returns uuid language plpgsql as $$
begin
  return quotation_bill(p_qt, 'INV', p_date, 'all');
end $$;

-- ดำเนินการแล้ว (กดเอง) / เก็บเงินทั้งหมด: ปิดยอดคงเหลือโดยไม่ออกเอกสาร
create or replace function close_quotation(p_qt uuid) returns void language plpgsql as $$
declare q sales_docs; v_rem numeric;
begin
  select * into q from sales_docs where id = p_qt and doc_type = 'QT' for update;
  if not found or q.status not in ('approved','partial') then raise exception 'ปิดงานได้เฉพาะใบเสนอราคาที่อนุมัติแล้วหรือแบ่งจ่าย'; end if;
  v_rem := q.total - quotation_billed(p_qt) - (select coalesce(sum(amount), 0) from quotation_closeouts where qt_id = p_qt and voided_at is null);
  if v_rem <= 0 then raise exception 'ไม่มียอดคงเหลือให้ปิด'; end if;
  insert into quotation_closeouts(qt_id, amount, actor_id) values (p_qt, v_rem, doc_event_actor());
  insert into doc_events(doc_id, event, detail, actor_id) values (p_qt, 'billing', 'close:' || v_rem, doc_event_actor());
  perform quotation_refresh(p_qt);
end $$;

-- ยกเลิกการปิดยอด (ยกเลิกการเก็บเงิน)
create or replace function reopen_quotation(p_qt uuid) returns void language plpgsql as $$
begin
  update quotation_closeouts set voided_at = now() where qt_id = p_qt and voided_at is null;
  if not found then raise exception 'ใบเสนอราคานี้ไม่มียอดที่ปิดไว้'; end if;
  insert into doc_events(doc_id, event, detail, actor_id) values (p_qt, 'billing', 'reopen', doc_event_actor());
  perform quotation_refresh(p_qt);
end $$;

-- รีเซ็ต: กลับเป็นรออนุมัติ — ใบแจ้งหนี้/ขายสดที่ยังไม่ยกเลิกผูกอยู่ต้องยกเลิกก่อน (บัญชีต้องไม่ลอย; FA ไม่กัน) ส่วนใบวางบิลไม่กระทบบัญชี คงไว้
create or replace function reset_quotation(p_id uuid) returns void language plpgsql as $$
begin
  if exists (select 1 from sales_docs where ref_doc_id = p_id and doc_type in ('INV','CA') and status <> 'cancelled') then
    raise exception 'ใบเสนอราคามีใบแจ้งหนี้ผูกอยู่ (รวมขายสด) ต้องยกเลิกก่อน';
  end if;
  update sales_docs set status = 'pending_approval' where id = p_id and doc_type = 'QT' and status in ('rejected','approved','partial','converted');
  if not found then raise exception 'รีเซ็ตได้เฉพาะใบเสนอราคาที่อนุมัติแล้ว แบ่งจ่าย ดำเนินการแล้ว หรือไม่อนุมัติ'; end if;
  update quotation_closeouts set voided_at = now() where qt_id = p_id and voided_at is null;
end $$;
