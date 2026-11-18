alter table sales_docs add column billed_at timestamptz;
update sales_docs set billed_at = created_at where doc_type = 'INV';
alter table sales_docs add column status_view text generated always as
  (case when doc_type = 'INV' and status = 'awaiting_payment' and billed_at is null then 'inv_pending' else status end) stored;
create function invoice_set_billed(p_id uuid, p_billed boolean) returns void language plpgsql as $$
declare d sales_docs;
begin
  select * into d from sales_docs where id = p_id and doc_type = 'INV' for update;
  if not found then raise exception 'ไม่พบใบแจ้งหนี้'; end if;
  if d.status <> 'awaiting_payment' then raise exception 'เปลี่ยนได้เฉพาะใบแจ้งหนี้ที่รอดำเนินการ/รอเก็บเงิน'; end if;
  if p_billed and d.billed_at is not null then raise exception 'ใบแจ้งหนี้นี้วางบิลแล้ว'; end if;
  if not p_billed and d.billed_at is null then raise exception 'ใบแจ้งหนี้นี้ยังไม่ได้วางบิล'; end if;
  update sales_docs set billed_at = case when p_billed then now() end where id = p_id;
  insert into doc_events(doc_id, event, detail, actor_id)
  values (p_id, 'status', case when p_billed then 'inv_pending>awaiting_payment' else 'awaiting_payment>inv_pending' end, doc_event_actor());
end $$;
create function billing_note_set_status(p_id uuid, p_to text) returns void language plpgsql as $$
declare d sales_docs;
begin
  select * into d from sales_docs where id = p_id and doc_type = 'BL' for update;
  if not found then raise exception 'ไม่พบใบวางบิล'; end if;
  if d.is_deposit then raise exception 'ใบวางบิลมัดจำใช้เมนูมัดจำ'; end if;
  if p_to = 'billed' and d.status <> 'pending_billing' then raise exception 'วางบิลแล้วได้เฉพาะใบที่รอวางบิล'; end if;
  if p_to = 'invoice_opened' and d.status not in ('pending_billing','billed') then raise exception 'เปิดบิลแล้วได้เฉพาะใบที่รอวางบิล/วางบิลแล้ว'; end if;
  if p_to = 'pending_billing' then
    if d.status not in ('billed','invoice_opened') then raise exception 'รีเซ็ตได้เฉพาะใบที่วางบิลแล้ว/เปิดบิลแล้ว'; end if;
    if exists (select 1 from sales_docs where ref_doc_id = d.id and doc_type in ('INV','CA') and status <> 'cancelled') then
      raise exception 'ใบวางบิลนี้เปิดเป็นใบแจ้งหนี้แล้ว ต้องยกเลิกใบแจ้งหนี้ก่อน';
    end if;
  end if;
  if p_to not in ('billed','invoice_opened','pending_billing') then raise exception 'สถานะ % ไม่ถูกต้อง', p_to; end if;
  update sales_docs set status = p_to where id = p_id;
end $$;
create function billing_note_to_invoice(p_bl uuid, p_date date) returns uuid language plpgsql as $$
declare b sales_docs; v_lines jsonb; v_id uuid;
begin
  select * into b from sales_docs where id = p_bl and doc_type = 'BL' for update;
  if not found then raise exception 'ไม่พบใบวางบิล'; end if;
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
create function reset_cancelled_sales_doc(p_id uuid) returns void language plpgsql as $$
declare d sales_docs; q sales_docs; v_lines jsonb; v_type text; v_v uuid;
begin
  select * into d from sales_docs where id = p_id for update;
  if not found then raise exception 'ไม่พบเอกสาร'; end if;
  if d.status <> 'cancelled' then raise exception 'รีเซ็ตได้เฉพาะเอกสารที่ยกเลิกแล้ว'; end if;
  if d.doc_type not in ('INV','CA','BL') then raise exception 'เอกสารชนิดนี้ใช้เมนูรีเซ็ตของตัวเอง'; end if;
  if d.is_deposit or coalesce(d.deposit_net, 0) > 0 then raise exception 'รีเซ็ตเอกสารมัดจำ/หักมัดจำยังไม่รองรับ (ยังไม่ทดสอบบน FA) — ออกเอกสารใหม่แทน'; end if;
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
                           term_mode, credit_days, due_date, salesperson, project, ref_no, description, note, show_signature, discount_total, exempt_base,
                           ontop_type, ontop_value, ontop_total)
    values (v_id, 'BL', next_doc_no('BL', p_date, true), p_date, q.contact_id, 'pending_billing', p_qt, q.price_mode, q.vat_rate, q.subtotal, q.vat, q.total,
            case when q.term_mode = 'cash' then 'credit' else q.term_mode end, case when q.term_mode = 'cash' then 0 else q.credit_days end,
            case when q.term_mode = 'credit' then p_date + q.credit_days end,
            q.salesperson, q.project, q.ref_no, q.description, q.note, q.show_signature, q.discount_total, q.exempt_base,
            q.ontop_type, q.ontop_value, q.ontop_total);
    insert into sales_doc_lines(doc_id, line_no, description, detail, item_kind, qty, unit_price, amount, product_id, warehouse_id, unit,
                                discount_type, discount_value, discount, vat_rate, vat_exempt, wht_rate, wht, src_line_no, ontop)
      select v_id, line_no, description, detail, item_kind, qty, unit_price, amount, product_id, warehouse_id, unit,
             discount_type, discount_value, discount, vat_rate, vat_exempt, wht_rate, wht, line_no, ontop from sales_doc_lines where doc_id = p_qt;
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
        'vat', case when r.vat_exempt then 'exempt' else trim_scale(coalesce(r.vat_rate, 7))::text end, 'wht_rate', r.wht_rate, 'src_line_no', r.line_no,
        'ontop', case when r.ontop > 0 then round(r.ontop * v_new / r.qty, 2) else 0 end);   -- ส่วนลด On Top ตามสัดส่วนจำนวนที่เรียกเก็บ
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
create or replace function create_final_invoice(p_qt uuid, p_date date, p_kind text default 'INV') returns uuid language plpgsql as $$
declare q sales_docs; dep sales_docs; v_lines jsonb; v_id uuid;
begin
  if p_kind not in ('INV','CA','BL') then raise exception 'ชนิดเอกสาร % ไม่ถูกต้อง', p_kind; end if;
  select * into q from sales_docs where id = p_qt and doc_type = 'QT' for update;
  if not found or q.status <> 'deposit_paid' then raise exception 'ใบเสนอราคานี้ยังไม่มีมัดจำ'; end if;
  select * into dep from sales_docs where ref_doc_id = p_qt and is_deposit and status not in ('cancelled','invoice_opened')
   order by (doc_type = 'BL') limit 1;   -- ใช้ INV/CA ก่อน; BL เฉพาะที่ยังไม่แปลง
  if not found then raise exception 'ไม่พบเอกสารมัดจำที่ใช้งานอยู่'; end if;
  if p_kind = 'BL' then
    v_id := gen_random_uuid();
    insert into sales_docs(id, doc_type, doc_no, doc_date, contact_id, status, ref_doc_id, price_mode, vat_rate, subtotal, vat, total,
                           term_mode, credit_days, due_date, salesperson, project, ref_no, description, note, show_signature,
                           discount_total, exempt_base, deposit_net, deposit_vat, ontop_type, ontop_value, ontop_total)
    values (v_id, 'BL', next_doc_no('BL', p_date, true), p_date, q.contact_id, 'pending_billing', p_qt, q.price_mode, q.vat_rate,
            q.subtotal, q.vat - dep.vat, q.total - dep.total,
            case when q.term_mode = 'cash' then 'credit' else q.term_mode end, case when q.term_mode = 'cash' then 0 else q.credit_days end,
            case when q.term_mode = 'credit' then p_date + q.credit_days end,
            q.salesperson, q.project, q.ref_no, q.description, q.note, q.show_signature, q.discount_total, q.exempt_base,
            dep.subtotal, dep.vat, q.ontop_type, q.ontop_value, q.ontop_total);
    insert into sales_doc_lines(doc_id, line_no, description, detail, item_kind, qty, unit_price, amount, product_id, warehouse_id, unit,
                                discount_type, discount_value, discount, vat_rate, vat_exempt, wht_rate, wht, src_line_no, ontop)
      select v_id, line_no, description, detail, item_kind, qty, unit_price, amount, product_id, warehouse_id, unit,
             discount_type, discount_value, discount, vat_rate, vat_exempt, wht_rate, wht, line_no, ontop from sales_doc_lines where doc_id = p_qt;
  else
    select jsonb_agg(jsonb_build_object('description',description,'kind',item_kind,'qty',qty,'unit_price',unit_price,'product_id',product_id,'warehouse_id',warehouse_id) order by line_no)
      into v_lines from sales_doc_lines where doc_id = p_qt;
    v_id := create_sales_doc(p_kind, p_date, q.contact_id, v_lines, q.price_mode, q.vat_rate, p_qt, null, dep.subtotal, dep.vat);
  end if;
  update sales_docs set status = 'converted' where id = p_qt;
  return v_id;
end $$;
create or replace function cancel_sales_doc(p_id uuid) returns void language plpgsql as $$
declare d sales_docs; q sales_docs;
begin
  select * into d from sales_docs where id = p_id for update;
  if not found then raise exception 'ไม่พบเอกสาร'; end if;
  if d.status = 'cancelled' then raise exception 'เอกสารถูกยกเลิกแล้ว'; end if;
  if sales_doc_has_active_receipt(d.id) then
    raise exception 'เอกสารมีใบเสร็จผูกอยู่ ต้องยกเลิกใบเสร็จก่อน';
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
create function reset_cancelled_receipt(p_id uuid) returns void language plpgsql as $$
declare r receipts; it record; d sales_docs; v_due numeric; v_lines jsonb; v_type text; v_v uuid;
begin
  select * into r from receipts where id = p_id for update;
  if not found then raise exception 'ไม่พบใบเสร็จ'; end if;
  if r.status <> 'cancelled' then raise exception 'รีเซ็ตได้เฉพาะใบเสร็จที่ยกเลิกแล้ว'; end if;
  for it in select doc_id, sum(amount) amt from receipt_items where receipt_id = p_id and doc_id is not null group by doc_id loop
    select * into d from sales_docs where id = it.doc_id;
    if d.status = 'cancelled' then raise exception 'เอกสาร % ถูกยกเลิกแล้ว รีเซ็ตใบเสร็จไม่ได้', d.doc_no; end if;
    v_due := d.total - coalesce((select sum(total) from sales_docs where ref_doc_id = d.id and doc_type = 'CN' and status <> 'cancelled'), 0);
    if doc_receipted(d.id) + it.amt > v_due + 0.005 then raise exception 'เอกสาร % มีใบเสร็จอื่นรับชำระแล้ว ยอดจะเกิน', d.doc_no; end if;
  end loop;
  if r.save_voucher_id is not null then
    select v.voucher_type, jsonb_agg(jsonb_build_object('account', a.code, case when l.debit > 0 then 'debit' else 'credit' end, greatest(l.debit, l.credit)) order by l.line_no)
      into v_type, v_lines
      from journal_lines l join journal_vouchers v on v.id = l.voucher_id join accounts a on a.id = l.account_id
     where l.voucher_id = r.save_voucher_id group by v.voucher_type;
    v_v := post_voucher(v_type, r.receipt_date, null, 'RE', r.id::text, v_lines);
  end if;
  update receipts set status = 'pending', save_voucher_id = v_v, collect_voucher_id = null where id = p_id;
  for it in select distinct doc_id from receipt_items where receipt_id = p_id and doc_id is not null loop
    perform recompute_invoice_status(it.doc_id);
  end loop;
end $$;
