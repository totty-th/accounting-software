-- M65 ใบวางบิลรวม (FA ทดสอบ 18-11-2026 · เจ้าของระบบสั่ง "ทำใบวางบิลรวมด้วย")
-- FA: เลือกลูกค้า → ติ๊กใบแจ้งหนี้ที่ค้างของลูกค้านั้น (ทั้งรอดำเนินการและรอเก็บเงิน) · ใบลดหนี้/ใบเพิ่มหนี้ของใบที่เลือกถูกดึงมาเป็นบรรทัดอัตโนมัติ (ใบลดหนี้ติดลบ)
--   ใช้เลขชุดเดียวกับใบวางบิล · เริ่มที่รอวางบิล · แก้ไขได้ขณะรอวางบิล
--   บันทึกแล้วใบแจ้งหนี้ทุกใบเป็น "รอเก็บเงิน" และถูกล็อกเมนูสถานะ (ยกเลิกใบวางบิลรวมแล้วใบแจ้งหนี้ยังเป็นรอเก็บเงิน ไม่ย้อนกลับ)
--   เมนู: รอวางบิล → วางบิลแล้ว / เปิดบิลแล้ว / สร้างใบเสร็จรวม / ยกเลิก · วางบิลแล้ว → เปิดบิลแล้ว / สร้างใบเสร็จรวม / ยกเลิก / รีเซ็ต · ยกเลิก → รีเซ็ต
--   สร้างใบเสร็จรวม → ใบเสร็จอ้างอิงเลขใบวางบิล · ใบวางบิลเป็น "เปิดใบเสร็จแล้ว" (ล็อก) · ยกเลิกใบเสร็จแล้วใบวางบิลยังเป็นเปิดใบเสร็จแล้ว (FA ไม่ย้อนกลับ)
alter table sales_docs add column is_combined boolean not null default false;
update sales_docs b set is_combined = true where doc_type = 'BL' and exists (select 1 from billing_note_items i where i.billing_id = b.id);
alter table billing_note_items add column line_no int, add column doc_total numeric(18,2), add column wht numeric(18,2), add column amount numeric(18,2);
alter table receipts add column billing_id uuid references sales_docs(id);

-- ใบวางบิลรวมที่ "ถือ" ใบแจ้งหนี้อยู่ (ใบที่เปิดใบเสร็จแล้ว/ยกเลิก ไม่นับ)
create function combined_bl_holding(p_doc uuid, p_except uuid default null) returns text language sql stable as $$
  select b.doc_no from billing_note_items i join sales_docs b on b.id = i.billing_id
   where i.invoice_id = p_doc and b.is_combined and b.status in ('pending_billing','billed','invoice_opened')
     and b.id is distinct from p_except limit 1;
$$;

-- ใบแจ้งหนี้ที่เลือกใส่ใบวางบิลรวมได้ของลูกค้า (ค้างรับ > 0 และไม่อยู่ในใบวางบิลรวมอื่น)
create function combined_bl_candidates(p_contact uuid, p_except uuid default null) returns table
  (id uuid, doc_no text, doc_date date, due_date date, total numeric, outstanding numeric, status_view text, adj text)
language sql stable as $$
  select d.id, d.doc_no, d.doc_date, d.due_date, d.total,
         d.total - doc_receipted(d.id) - coalesce((select sum(c.total) from sales_docs c where c.ref_doc_id = d.id and c.doc_type = 'CN' and c.status <> 'cancelled'), 0)
           + coalesce((select sum(n.total - doc_receipted(n.id)) from sales_docs n where n.ref_doc_id = d.id and n.doc_type = 'DN' and n.status <> 'cancelled'), 0),
         d.status_view,
         (select string_agg(a.doc_no, ', ' order by a.doc_no) from sales_docs a where a.ref_doc_id = d.id and a.doc_type in ('CN','DN') and a.status <> 'cancelled')
    from sales_docs d
   where d.doc_type = 'INV' and d.contact_id = p_contact and d.status in ('awaiting_payment','split_paid')
     and combined_bl_holding(d.id, p_except) is null
   order by d.doc_date, d.doc_no;
$$;

-- สร้าง/แก้ใบวางบิลรวม · p_id = null สร้างใหม่ · header: date, contact, credit_days, project, description, ref_no, note
create function save_combined_billing(p_id uuid, p_header jsonb, p_invoices uuid[]) returns uuid language plpgsql as $$
declare v_id uuid := coalesce(p_id, gen_random_uuid()); b sales_docs; d sales_docs; a sales_docs; inv uuid; n int := 0;
        v_date date := coalesce(nullif(p_header->>'date','')::date, today_th()); v_contact uuid := nullif(p_header->>'contact','')::uuid;
        v_days int := coalesce(nullif(p_header->>'credit_days','')::int, 0);
        v_out numeric; v_wht numeric; v_tot numeric := 0; v_vat numeric := 0; v_whts numeric := 0; seen uuid[] := '{}';
begin
  if v_contact is null then raise exception 'กรุณาเลือกลูกค้า'; end if;
  if p_invoices is null or array_length(p_invoices, 1) is null then raise exception 'ต้องเลือกใบแจ้งหนี้อย่างน้อย 1 ใบ'; end if;
  if p_id is not null then
    select * into b from sales_docs where id = p_id and doc_type = 'BL' and is_combined for update;
    if not found then raise exception 'ไม่พบใบวางบิลรวม'; end if;
    if b.status <> 'pending_billing' then raise exception 'แก้ไขได้เฉพาะใบวางบิลรวมที่รอวางบิล'; end if;
    if b.contact_id <> v_contact then raise exception 'เปลี่ยนลูกค้าของใบวางบิลรวมไม่ได้'; end if;
    perform assert_period_open(v_date);
    delete from billing_note_items where billing_id = p_id;
    update sales_docs set doc_date = v_date, credit_days = v_days, due_date = v_date + v_days, project = nullif(p_header->>'project',''),
        description = nullif(p_header->>'description',''), ref_no = nullif(p_header->>'ref_no',''), note = nullif(p_header->>'note','') where id = p_id;
  else
    insert into sales_docs(id, doc_type, doc_no, doc_date, contact_id, status, is_combined, credit_days, due_date, project, description, ref_no, note, term_mode)
    values (v_id, 'BL', next_doc_no('BL', v_date, true), v_date, v_contact, 'pending_billing', true, v_days, v_date + v_days,
            nullif(p_header->>'project',''), nullif(p_header->>'description',''), nullif(p_header->>'ref_no',''), nullif(p_header->>'note',''), 'credit');
  end if;
  foreach inv in array p_invoices loop
    if inv = any(seen) then continue; end if;
    seen := seen || inv;
    select * into d from sales_docs where id = inv and doc_type = 'INV' for update;
    if not found or d.contact_id <> v_contact or d.status not in ('awaiting_payment','split_paid') then
      raise exception 'ใบแจ้งหนี้ % ต้องเป็นของลูกค้าเดียวกันและยังค้างรับ', coalesce(d.doc_no, '');
    end if;
    if combined_bl_holding(inv, v_id) is not null then
      raise exception 'ใบแจ้งหนี้ % อยู่ในใบวางบิลรวม % แล้ว', d.doc_no, combined_bl_holding(inv, v_id);
    end if;
    -- ใบแจ้งหนี้: ยอดค้างก่อนหักใบลดหนี้ · หัก ณ ที่จ่ายคิดจากยอดหลังหักใบลดหนี้ (แบบเดียวกับใบเสร็จรวม)
    v_out := d.total - doc_receipted(inv);
    v_wht := wht_share(inv, v_out - coalesce((select sum(total) from sales_docs where ref_doc_id = inv and doc_type = 'CN' and status <> 'cancelled'), 0));
    n := n + 1;
    insert into billing_note_items(billing_id, invoice_id, line_no, doc_total, wht, amount) values (v_id, inv, n, v_out, v_wht, v_out - v_wht);
    v_tot := v_tot + v_out; v_whts := v_whts + v_wht; v_vat := v_vat + round(d.vat * v_out / nullif(d.total, 0), 2);
    for a in select * from sales_docs where ref_doc_id = inv and doc_type in ('CN','DN') and status <> 'cancelled' order by doc_date, doc_no loop
      if a.doc_type = 'CN' then
        n := n + 1;
        insert into billing_note_items(billing_id, invoice_id, line_no, doc_total, wht, amount) values (v_id, a.id, n, -a.total, 0, -a.total);
        v_tot := v_tot - a.total; v_vat := v_vat - a.vat;
      else
        v_out := a.total - doc_receipted(a.id);
        if v_out <= 0 then continue; end if;
        v_wht := wht_share(a.id, v_out);
        n := n + 1;
        insert into billing_note_items(billing_id, invoice_id, line_no, doc_total, wht, amount) values (v_id, a.id, n, v_out, v_wht, v_out - v_wht);
        v_tot := v_tot + v_out; v_whts := v_whts + v_wht; v_vat := v_vat + round(a.vat * v_out / nullif(a.total, 0), 2);
      end if;
    end loop;
    -- FA: ใบแจ้งหนี้ในใบวางบิลรวมเป็น "รอเก็บเงิน" ทันที
    if d.billed_at is null then
      update sales_docs set billed_at = now() where id = inv;
      insert into doc_events(doc_id, event, detail, actor_id) values (inv, 'status', 'inv_pending>awaiting_payment', doc_event_actor());
    end if;
  end loop;
  if v_tot <= 0 then raise exception 'ยอดรวมใบวางบิลต้องมากกว่า 0'; end if;
  update sales_docs set subtotal = v_tot - v_vat, vat = v_vat, total = v_tot, wht_total = v_whts where id = v_id;
  return v_id;
end $$;

-- ของเดิม (M2) คงไว้เพื่อความเข้ากันได้: สร้างใบวางบิลรวมแล้วตั้งเป็นวางบิลแล้ว
create or replace function create_billing_note(p_date date, p_contact uuid, p_invoices uuid[]) returns uuid language plpgsql as $$
declare v uuid;
begin
  v := save_combined_billing(null, jsonb_build_object('date', p_date, 'contact', p_contact), p_invoices);
  update sales_docs set status = 'billed' where id = v;
  return v;
end $$;

-- ใบเสร็จรวมจากใบวางบิลรวม (FA: ใบเสร็จอ้างอิงเลขใบวางบิล · ใบวางบิล → เปิดใบเสร็จแล้ว)
create function combined_billing_receipt(p_bl uuid, p_date date) returns uuid language plpgsql as $$
declare b sales_docs; v_invs uuid[]; v_r uuid;
begin
  select * into b from sales_docs where id = p_bl and doc_type = 'BL' and is_combined for update;
  if not found then raise exception 'ไม่พบใบวางบิลรวม'; end if;
  if b.status not in ('pending_billing','billed','invoice_opened') then raise exception 'สร้างใบเสร็จรวมได้เฉพาะใบวางบิลรวมที่ยังไม่ยกเลิก/ยังไม่เปิดใบเสร็จ'; end if;
  select array_agg(i.invoice_id order by i.line_no) into v_invs from billing_note_items i join sales_docs d on d.id = i.invoice_id
   where i.billing_id = p_bl and d.doc_type = 'INV' and d.status in ('awaiting_payment','split_paid');
  if v_invs is null then raise exception 'ใบแจ้งหนี้ในใบวางบิลนี้ไม่มียอดค้างรับแล้ว'; end if;
  v_r := create_combined_receipt(coalesce(p_date, today_th()), b.contact_id, v_invs);
  update receipts set billing_id = p_bl where id = v_r;
  update sales_docs set status = 'receipt_opened' where id = p_bl;
  return v_r;
end $$;

-- เปลี่ยนสถานะ: ใบวางบิลรวมไม่มีเมนูสร้างใบแจ้งหนี้ · ที่เหลือใช้ร่วมกับใบวางบิลปกติ
create or replace function billing_note_to_invoice(p_bl uuid, p_date date) returns uuid language plpgsql as $$
declare b sales_docs; v_lines jsonb; v_id uuid;
begin
  select * into b from sales_docs where id = p_bl and doc_type = 'BL' for update;
  if not found then raise exception 'ไม่พบใบวางบิล'; end if;
  if b.is_combined then raise exception 'ใบวางบิลรวมสร้างใบแจ้งหนี้ไม่ได้ (ใช้สร้างใบเสร็จรวม)'; end if;
  if b.is_deposit or coalesce(b.deposit_net, 0) > 0 then raise exception 'ใบวางบิลมัดจำ/หักมัดจำ ใช้เมนูของใบเสนอราคา'; end if;
  if b.status not in ('pending_billing','billed') then raise exception 'สร้างใบแจ้งหนี้ได้เฉพาะใบวางบิลที่รอวางบิล/วางบิลแล้ว'; end if;
  select jsonb_agg(jsonb_build_object('product_id', product_id, 'description', description, 'detail', detail, 'unit', unit, 'qty', qty,
           'unit_price', unit_price, 'discount_type', discount_type, 'discount_value', discount_value, 'warehouse_id', warehouse_id,
           'vat', case when vat_exempt then 'exempt' else trim_scale(coalesce(vat_rate, 7))::text end, 'wht_rate', wht_rate, 'ontop', ontop) order by line_no)
    into v_lines from sales_doc_lines where doc_id = p_bl;
  if v_lines is null then raise exception 'ใบวางบิลไม่มีรายการ'; end if;
  v_id := create_invoice_full(jsonb_build_object('date', coalesce(p_date, today_th()), 'contact', b.contact_id,
    'term_mode', case when b.term_mode = 'credit_nodate' then 'credit_nodate' else 'credit' end, 'credit_days', coalesce(b.credit_days, 0),
    'salesperson', b.salesperson, 'project', b.project, 'ref_no', b.doc_no, 'description', b.description, 'price_mode', b.price_mode,
    'warehouse_id', b.warehouse_id, 'show_signature', b.show_signature, 'note', b.note), v_lines, p_bl, 'INV');
  update sales_docs set billed_at = now() where id = v_id;
  update sales_docs set status = 'invoice_opened' where id = p_bl;
  return v_id;
end $$;

-- ยกเลิก → รีเซ็ต ของใบวางบิลรวม: ใบแจ้งหนี้ทุกใบต้องยังค้างรับและไม่ถูกใบวางบิลรวมอื่นถือไว้
create or replace function reset_cancelled_sales_doc(p_id uuid) returns void language plpgsql as $$
declare d sales_docs; q sales_docs; v_lines jsonb; v_type text; v_v uuid; x record;
begin
  select * into d from sales_docs where id = p_id for update;
  if not found then raise exception 'ไม่พบเอกสาร'; end if;
  if d.status <> 'cancelled' then raise exception 'รีเซ็ตได้เฉพาะเอกสารที่ยกเลิกแล้ว'; end if;
  if d.doc_type not in ('INV','CA','BL') then raise exception 'เอกสารชนิดนี้ใช้เมนูรีเซ็ตของตัวเอง'; end if;
  if d.is_deposit or coalesce(d.deposit_net, 0) > 0 then raise exception 'รีเซ็ตเอกสารมัดจำ/หักมัดจำยังไม่รองรับ (ยังไม่ทดสอบบน FA) — ออกเอกสารใหม่แทน'; end if;
  if d.is_combined then
    for x in select s.doc_no, s.doc_type, s.status, combined_bl_holding(s.id, d.id) other from billing_note_items i join sales_docs s on s.id = i.invoice_id where i.billing_id = d.id loop
      if x.doc_type = 'INV' and x.status not in ('awaiting_payment','split_paid') then raise exception 'ใบแจ้งหนี้ % ไม่ค้างรับแล้ว รีเซ็ตไม่ได้', x.doc_no; end if;
      if x.other is not null then raise exception 'ใบแจ้งหนี้ % อยู่ในใบวางบิลรวม % แล้ว', x.doc_no, x.other; end if;
    end loop;
    update sales_docs set status = 'pending_billing' where id = p_id;
    return;
  end if;
  if d.ref_doc_id is not null then
    select * into q from sales_docs where id = d.ref_doc_id;
    if q.status = 'cancelled' then raise exception 'เอกสารต้นทาง % ถูกยกเลิกแล้ว รีเซ็ตไม่ได้', q.doc_no; end if;
  end if;
  if d.doc_type = 'BL' then
    if q.doc_type = 'QT' and exists (select 1 from sales_docs where ref_doc_id = q.id and doc_type = 'BL' and status <> 'cancelled' and not is_deposit and id <> d.id) then
      raise exception 'ใบเสนอราคา % มีใบวางบิลอื่นที่ใช้งานอยู่แล้ว', q.doc_no;
    end if;
    update sales_docs set status = 'pending_billing' where id = p_id;
  else
    select v.voucher_type, jsonb_agg(jsonb_build_object('account', a.code, case when l.debit > 0 then 'debit' else 'credit' end, greatest(l.debit, l.credit)) order by l.line_no)
      into v_type, v_lines
      from journal_lines l join journal_vouchers v on v.id = l.voucher_id join accounts a on a.id = l.account_id
     where l.voucher_id = d.voucher_id group by v.voucher_type;
    if v_lines is null then raise exception 'ไม่พบรายการบัญชีเดิมของเอกสาร'; end if;
    v_v := post_voucher(v_type, d.doc_date, null, d.doc_type, d.id::text, v_lines);
    update sales_docs set status = case d.doc_type when 'CA' then 'pending_collect' else 'awaiting_payment' end,
        voucher_id = v_v, collect_voucher_id = null, billed_at = null where id = p_id;
    perform stock_issue_for_doc(p_id);
  end if;
  if q.doc_type = 'QT' then perform quotation_refresh(q.id); end if;
end $$;

-- ใบแจ้งหนี้ในใบวางบิลรวมที่ใช้งานอยู่: ล็อกเมนูรีเซ็ตสถานะ (FA ไม่มีปุ่มสถานะ)
create or replace function invoice_set_billed(p_id uuid, p_billed boolean) returns void language plpgsql as $$
declare d sales_docs;
begin
  select * into d from sales_docs where id = p_id and doc_type = 'INV' for update;
  if not found then raise exception 'ไม่พบใบแจ้งหนี้'; end if;
  if d.status <> 'awaiting_payment' then raise exception 'เปลี่ยนได้เฉพาะใบแจ้งหนี้ที่รอดำเนินการ/รอเก็บเงิน'; end if;
  if combined_bl_holding(p_id) is not null then raise exception 'ใบแจ้งหนี้อยู่ในใบวางบิลรวม % เปลี่ยนสถานะไม่ได้', combined_bl_holding(p_id); end if;
  if p_billed and d.billed_at is not null then raise exception 'ใบแจ้งหนี้นี้วางบิลแล้ว'; end if;
  if not p_billed and d.billed_at is null then raise exception 'ใบแจ้งหนี้นี้ยังไม่ได้วางบิล'; end if;
  update sales_docs set billed_at = case when p_billed then now() end where id = p_id;
  insert into doc_events(doc_id, event, detail, actor_id)
  values (p_id, 'status', case when p_billed then 'inv_pending>awaiting_payment' else 'awaiting_payment>inv_pending' end, doc_event_actor());
end $$;

-- ยกเลิกใบแจ้งหนี้/ใบลด-เพิ่มหนี้ที่อยู่ในใบวางบิลรวมที่ใช้งานอยู่ไม่ได้ (FA ล็อกเมนู)
create or replace function cancel_sales_doc(p_id uuid) returns void language plpgsql as $$
declare d sales_docs; q sales_docs;
begin
  select * into d from sales_docs where id = p_id for update;
  if not found then raise exception 'ไม่พบเอกสาร'; end if;
  if d.status = 'cancelled' then raise exception 'เอกสารถูกยกเลิกแล้ว'; end if;
  if sales_doc_has_active_receipt(d.id) then
    raise exception 'เอกสารมีใบเสร็จผูกอยู่ ต้องยกเลิกใบเสร็จก่อน';
  end if;
  if d.doc_type in ('INV','CN','DN') and combined_bl_holding(d.id) is not null then
    raise exception 'เอกสารอยู่ในใบวางบิลรวม % ต้องยกเลิกใบวางบิลรวมก่อน', combined_bl_holding(d.id);
  end if;
  if d.doc_type = 'INV' then
    if exists (select 1 from sales_docs where ref_doc_id = d.id and doc_type = 'DN' and status <> 'cancelled') then
      raise exception 'ใบแจ้งหนี้มีใบเพิ่มหนี้ผูกอยู่ ต้องยกเลิกใบเพิ่มหนี้ก่อน';
    end if;
    if exists (select 1 from sales_docs where ref_doc_id = d.id and doc_type = 'CN' and status <> 'cancelled') then
      raise exception 'ใบแจ้งหนี้มีใบลดหนี้ผูกอยู่ ต้องยกเลิกใบลดหนี้ก่อน';
    end if;
  end if;
  if d.doc_type = 'BL' and exists (select 1 from sales_docs where ref_doc_id = d.id and doc_type in ('INV','CA') and status <> 'cancelled') then
    raise exception 'ใบวางบิลนี้เปิดเป็นใบแจ้งหนี้แล้ว ต้องยกเลิกใบแจ้งหนี้ก่อน';
  end if;
  if d.is_deposit and d.doc_type = 'BL' and d.status = 'invoice_opened' then
    raise exception 'ใบวางบิลมัดจำนี้เปิดเป็นใบแจ้งหนี้แล้ว ต้องยกเลิกใบแจ้งหนี้มัดจำแทน';
  end if;
  if d.is_deposit and exists (select 1 from sales_docs where ref_doc_id = d.ref_doc_id and deposit_net > 0 and status <> 'cancelled') then
    raise exception 'ต้องยกเลิกเอกสารฉบับสุดท้ายก่อน';
  end if;
  if d.doc_type in ('INV','CA') then perform stock_return_for_doc(d.id); end if;
  if d.doc_type in ('CN','DN') then perform stock_reverse_adjust(d.id); end if;
  if d.collect_voucher_id is not null then perform reverse_voucher(d.collect_voucher_id); end if;
  if d.voucher_id is not null then perform reverse_voucher(d.voucher_id); end if;
  update sales_docs set status = 'cancelled' where id = d.id;
  if d.doc_type in ('INV','CA','BL') and d.ref_doc_id is not null then
    select * into q from sales_docs where id = d.ref_doc_id and doc_type = 'QT';
    if found then
      if d.is_deposit then
        if not exists (select 1 from sales_docs where ref_doc_id = q.id and is_deposit and status <> 'cancelled') then
          update sales_docs set status = 'approved' where id = q.id;
        end if;
      elsif d.deposit_net > 0 then update sales_docs set status = 'deposit_paid' where id = q.id;
      end if;
    end if;
  end if;
end $$;
