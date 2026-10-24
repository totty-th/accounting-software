create table doc_events (
  id        bigserial primary key,
  doc_id    uuid not null references sales_docs(id),
  event     text not null check (event in ('created','status','note','file_added','file_removed','wht')),
  detail    text,
  actor_id  uuid references app_users(id),
  at        timestamptz not null default now()
);
create index on doc_events (doc_id, id);
alter table sales_docs add column internal_note text;
create function doc_event_actor() returns uuid language sql stable as $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;
create function sales_docs_log() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    insert into doc_events(doc_id, event, detail, actor_id) values (new.id, 'created', new.status, doc_event_actor());
  else
    if new.status is distinct from old.status then
      insert into doc_events(doc_id, event, detail, actor_id) values (new.id, 'status', old.status || '>' || new.status, doc_event_actor());
    end if;
    if new.internal_note is distinct from old.internal_note then
      insert into doc_events(doc_id, event, detail, actor_id) values (new.id, 'note', null, doc_event_actor());
    end if;
    if new.wht_rate is distinct from old.wht_rate then
      insert into doc_events(doc_id, event, detail, actor_id) values (new.id, 'wht', old.wht_rate || '>' || new.wht_rate, doc_event_actor());
    end if;
  end if;
  return null;
end $$;
create trigger sales_docs_log_i after insert on sales_docs for each row execute function sales_docs_log();
create trigger sales_docs_log_u after update on sales_docs for each row execute function sales_docs_log();
create function set_sales_doc_note(p_id uuid, p_note text) returns void language plpgsql as $$
begin
  update sales_docs set internal_note = nullif(btrim(coalesce(p_note,'')), '') where id = p_id;
  if not found then raise exception 'ไม่พบเอกสาร'; end if;
end $$;
create table sales_doc_files (
  id         uuid primary key default gen_random_uuid(),
  doc_id     uuid not null references sales_docs(id),
  filename   text not null,
  mime       text not null,
  size       int  not null check (size > 0 and size <= 5242880),
  data       bytea not null,
  created_by uuid references app_users(id),
  created_at timestamptz not null default now()
);
create index on sales_doc_files (doc_id);
create function add_sales_doc_file(p_doc uuid, p_name text, p_mime text, p_data bytea) returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  if not exists (select 1 from sales_docs where id = p_doc) then raise exception 'ไม่พบเอกสาร'; end if;
  if (select count(*) from sales_doc_files where doc_id = p_doc) >= 5 then raise exception 'แนบไฟล์ได้สูงสุด 5 ไฟล์ต่อเอกสาร'; end if;
  if length(p_data) = 0 then raise exception 'ไฟล์ว่างเปล่า'; end if;
  if length(p_data) > 5242880 then raise exception 'ไฟล์ใหญ่เกิน 5 MB'; end if;
  insert into sales_doc_files(id, doc_id, filename, mime, size, data, created_by)
  values (v_id, p_doc, p_name, coalesce(nullif(p_mime,''), 'application/octet-stream'), length(p_data), p_data, doc_event_actor());
  insert into doc_events(doc_id, event, detail, actor_id) values (p_doc, 'file_added', p_name, doc_event_actor());
  return v_id;
end $$;
create function remove_sales_doc_file(p_file uuid) returns void language plpgsql as $$
declare f sales_doc_files;
begin
  delete from sales_doc_files where id = p_file returning * into f;
  if not found then raise exception 'ไม่พบไฟล์'; end if;
  insert into doc_events(doc_id, event, detail, actor_id) values (f.doc_id, 'file_removed', f.filename, doc_event_actor());
end $$;
create function set_debit_note_wht(p_dn uuid, p_rate numeric) returns void language plpgsql as $$
begin
  if p_rate < 0 or p_rate > 15 then raise exception 'อัตราหัก ณ ที่จ่ายไม่ถูกต้อง'; end if;
  if sales_doc_has_active_receipt(p_dn) then raise exception 'มีใบเสร็จแล้ว แก้อัตราหัก ณ ที่จ่ายไม่ได้'; end if;
  update sales_docs set wht_rate = p_rate where id = p_dn and doc_type = 'DN' and status <> 'cancelled';
  if not found then raise exception 'ไม่พบใบเพิ่มหนี้'; end if;
end $$;
create or replace function create_combined_receipt(p_date date, p_contact uuid, p_invoices uuid[])
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid(); inv uuid; i sales_docs; dn sales_docs; n int := 0;
        v_amt numeric; v_wht numeric; v_tot numeric := 0; v_whts numeric := 0;
begin
  if p_invoices is null or array_length(p_invoices,1) is null then raise exception 'ต้องเลือกใบแจ้งหนี้อย่างน้อย 1 ใบ'; end if;
  insert into receipts(id, receipt_no, kind, receipt_date, contact_id, amount, wht)
  values (v_id, next_doc_no('RE', p_date, true), 'combined', p_date, p_contact, 1, 0);
  foreach inv in array p_invoices loop
    select * into i from sales_docs where id = inv and doc_type = 'INV' and contact_id = p_contact
       and status in ('awaiting_payment','split_paid');
    if not found then raise exception 'ใบแจ้งหนี้ที่เลือกต้องเป็นของลูกค้าเดียวกันและรอเก็บเงิน'; end if;
    v_amt := i.total - doc_receipted(inv) - coalesce((select sum(total) from sales_docs
               where ref_doc_id = inv and doc_type = 'CN' and status <> 'cancelled'), 0);
    if v_amt > 0 then
      v_wht := wht_share(inv, v_amt);
      n := n + 1;
      insert into receipt_items(receipt_id, line_no, doc_id, amount, wht) values (v_id, n, inv, v_amt, v_wht);
      v_tot := v_tot + v_amt; v_whts := v_whts + v_wht;
    end if;
    for dn in select * from sales_docs where ref_doc_id = inv and doc_type = 'DN' and status <> 'cancelled' loop
      v_amt := dn.total - doc_receipted(dn.id);
      if v_amt > 0 then
        v_wht := wht_share(dn.id, v_amt);
        n := n + 1;
        insert into receipt_items(receipt_id, line_no, doc_id, amount, wht) values (v_id, n, dn.id, v_amt, v_wht);
        v_tot := v_tot + v_amt; v_whts := v_whts + v_wht;
      end if;
    end loop;
  end loop;
  if v_tot <= 0 then raise exception 'ไม่มียอดค้างรับ'; end if;
  update receipts set amount = v_tot, wht = v_whts where id = v_id;
  perform post_receipt_save(v_id);
  foreach inv in array p_invoices loop perform recompute_invoice_status(inv); end loop;
  return v_id;
end $$;
create function restore_sales_doc(p_id uuid) returns void language plpgsql as $$
declare d sales_docs; r sales_docs; l sales_doc_lines; v_lines jsonb; v_v uuid;
        v_wh uuid; v_cost numeric; v_no text;
begin
  select * into d from sales_docs where id = p_id for update;
  if not found then raise exception 'ไม่พบเอกสาร'; end if;
  if d.doc_type not in ('CN','DN') then raise exception 'รีเซ็ตได้เฉพาะใบลดหนี้/ใบเพิ่มหนี้'; end if;
  if d.status <> 'cancelled' then raise exception 'รีเซ็ตได้เฉพาะเอกสารที่ยกเลิกแล้ว'; end if;
  select * into r from sales_docs where id = d.ref_doc_id for update;
  if r.status = 'cancelled' then raise exception 'ใบแจ้งหนี้อ้างอิงถูกยกเลิกแล้ว รีเซ็ตไม่ได้'; end if;
  if sales_doc_has_active_receipt(r.id) then raise exception 'ใบแจ้งหนี้นี้มีใบเสร็จผูกอยู่ รีเซ็ตไม่ได้'; end if;
  if d.doc_type = 'DN' and r.status <> 'awaiting_payment' then
    raise exception 'ออกใบเพิ่มหนี้ได้เฉพาะใบแจ้งหนี้สถานะรอเก็บเงิน';
  end if;
  if d.doc_type = 'CN' and d.total > r.total - coalesce((
       select sum(total) from sales_docs where ref_doc_id = r.id and doc_type = 'CN' and status <> 'cancelled' and id <> d.id), 0) then
    raise exception 'ยอดใบลดหนี้เกินยอดใบแจ้งหนี้ที่เหลือ';
  end if;
  if d.doc_type = 'DN' then
    v_lines := jsonb_build_array(jsonb_build_object('account','11311','debit',d.total),
                                 jsonb_build_object('account','41210','credit',d.subtotal));
    if d.vat > 0 then v_lines := v_lines || jsonb_build_object('account','27111','credit',d.vat); end if;
  else
    v_lines := jsonb_build_array(jsonb_build_object('account','41400','debit',d.subtotal));
    if d.vat > 0 then v_lines := v_lines || jsonb_build_object('account','27111','debit',d.vat); end if;
    v_lines := v_lines || jsonb_build_object('account','11311','credit',d.total);
  end if;
  v_v := post_voucher('SV', d.doc_date, null, d.doc_type, d.id::text, v_lines);
  for l in select * from sales_doc_lines where doc_id = d.id order by line_no loop
    if l.product_id is null or l.stock_action not in ('return','cut') then continue; end if;
    if not exists (select 1 from products where id = l.product_id and kind = 'goods_stock') then continue; end if;
    select warehouse_id into v_wh from sales_doc_lines where doc_id = r.id and product_id = l.product_id limit 1;
    v_wh := coalesce(v_wh, main_warehouse());
    if l.stock_action = 'return' then
      select unit_cost into v_cost from stock_movements
       where doc_id = r.id and product_id = l.product_id and qty_out > 0 and voided_at is null limit 1;
      v_cost := coalesce(v_cost, product_avg_cost(l.product_id));
      perform stock_in(l.product_id, v_wh, l.qty, round(l.qty * v_cost, 2), d.doc_date, d.doc_type, d.id, d.doc_no);
    else
      perform stock_out(l.product_id, v_wh, l.qty, d.doc_date, d.doc_type, d.id, d.doc_no);
    end if;
  end loop;
  update sales_docs set status = case d.doc_type when 'CN' then 'approved' else 'active' end,
                        voucher_id = v_v where id = d.id;
  if d.doc_type = 'DN' then update sales_docs set status = 'awaiting_payment' where id = r.id; end if;
end $$;
