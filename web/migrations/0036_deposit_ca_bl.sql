create or replace function create_sales_doc(
  p_type text, p_date date, p_contact uuid, p_lines jsonb,
  p_price_mode text default 'exclusive', p_vat_rate numeric default 7,
  p_ref uuid default null, p_reason text default null,
  p_deposit_net numeric default 0, p_deposit_vat numeric default 0
) returns uuid language plpgsql as $$
declare
  v_id uuid := gen_random_uuid(); v_contact uuid := p_contact; v_status text;
  l jsonb; n int := 0; v_amt numeric; v_kind text;
  v_goods numeric := 0; v_serv numeric := 0; v_gross numeric;
  v_net numeric; v_net_goods numeric; v_net_serv numeric; v_vat numeric; v_total numeric;
  v_ref sales_docs; v_voucher uuid; v_lines jsonb := '[]'::jsonb;
  v_vtype text; v_rev_cr jsonb := '[]'::jsonb; v_act text; v_pid uuid; v_cost numeric; v_wh uuid; v_srcqty numeric;
begin
  if p_type not in ('QT','INV','CA','CN','DN') then
    raise exception 'ประเภทเอกสาร % สร้างด้วยฟังก์ชันนี้ไม่ได้', p_type;
  end if;
  if p_lines is null or jsonb_array_length(p_lines) = 0 then raise exception 'ต้องมีรายการอย่างน้อย 1 บรรทัด'; end if;
  if p_type = 'CA' and v_contact is null then v_contact := ensure_cash_contact(); end if;
  if v_contact is null then raise exception 'ต้องระบุลูกค้า'; end if;
  if p_type in ('CN','DN') then
    if p_ref is null then raise exception 'ใบ % ต้องอ้างอิงใบแจ้งหนี้', p_type; end if;
    select * into v_ref from sales_docs where id = p_ref;
    if not found or v_ref.doc_type <> 'INV' or v_ref.status = 'cancelled' then
      raise exception 'เอกสารอ้างอิงต้องเป็นใบแจ้งหนี้ที่ยังไม่ถูกยกเลิก';
    end if;
    v_contact := v_ref.contact_id;
    p_price_mode := v_ref.price_mode; p_vat_rate := v_ref.vat_rate;
  end if;
  if p_type = 'CN' then
    if btrim(coalesce(p_reason,'')) = '' then raise exception 'ใบลดหนี้ต้องระบุเหตุผล'; end if;
    if sales_doc_has_active_receipt(p_ref) then raise exception 'ใบแจ้งหนี้นี้มีใบเสร็จผูกอยู่ ออกใบลดหนี้ไม่ได้'; end if;
    if exists (select 1 from sales_docs where ref_doc_id = p_ref and doc_type = 'CN') then
      raise exception 'ใบแจ้งหนี้นี้เคยถูกสร้างเป็นใบลดหนี้แล้ว';  -- ต้นแบบ: 1 ใบแจ้งหนี้ต่อ 1 ใบลดหนี้ (นับฉบับที่ยกเลิกแล้วด้วย)
    end if;
  end if;
  if p_type = 'DN' and v_ref.status <> 'awaiting_payment' then
    raise exception 'ออกใบเพิ่มหนี้ได้เฉพาะใบแจ้งหนี้สถานะรอเก็บเงิน';  -- สันนิษฐาน: ต้นแบบทดสอบแค่กรณีนี้
  end if;
  for l in select * from jsonb_array_elements(p_lines) loop
    v_act := nullif(l->>'stock_action','');
    if v_act is null then continue; end if;
    if p_type = 'CN' and v_act not in ('return','no_return') then raise exception 'ใบลดหนี้เลือกได้เฉพาะ คืนสินค้า/ไม่คืน'; end if;
    if p_type = 'DN' and v_act not in ('adjust','cut') then raise exception 'ใบเพิ่มหนี้เลือกได้เฉพาะ ปรับราคา/ตัดสต็อก'; end if;
    if p_type not in ('CN','DN') then raise exception 'ตัวเลือกสต็อกใช้ได้เฉพาะใบลดหนี้/ใบเพิ่มหนี้'; end if;
    v_pid := nullif(l->>'product_id','')::uuid;
    if v_pid is not null and p_type = 'CN' then   -- คืนไม่เกินจำนวนในใบแจ้งหนี้
      select coalesce(sum(qty),0) into v_srcqty from sales_doc_lines where doc_id = p_ref and product_id = v_pid;
      if (select coalesce(sum((x->>'qty')::numeric),0) from jsonb_array_elements(p_lines) x
           where nullif(x->>'product_id','')::uuid = v_pid) > v_srcqty then
        raise exception 'จำนวนที่ลดเกินจำนวนในใบแจ้งหนี้';
      end if;
    end if;
  end loop;
  for l in select * from jsonb_array_elements(p_lines) loop
    v_kind := line_kind(l);
    v_amt := round((l->>'qty')::numeric * (l->>'unit_price')::numeric, 2);
    if v_kind = 'goods' then v_goods := v_goods + v_amt; else v_serv := v_serv + v_amt; end if;
  end loop;
  v_gross := v_goods + v_serv;
  if p_price_mode = 'exclusive' then
    v_net := v_gross; v_net_goods := v_goods; v_net_serv := v_serv;
    v_vat := round(v_gross * p_vat_rate / 100, 2); v_total := v_gross + v_vat;
  else
    v_total := v_gross;
    v_net := round(v_gross * 100 / (100 + p_vat_rate), 2); v_vat := v_total - v_net;
    v_net_goods := round(v_goods * 100 / (100 + p_vat_rate), 2); v_net_serv := v_net - v_net_goods;
  end if;
  if p_deposit_net > 0 then   -- INV ฉบับสุดท้ายหลังมัดจำ (DEP-02)
    if p_type not in ('INV','CA') then raise exception 'หักมัดจำได้เฉพาะใบแจ้งหนี้และขายสด'; end if;
    v_vat := v_vat - p_deposit_vat;
    v_total := v_net + v_vat - p_deposit_net;
  end if;
  if p_type = 'CN' and v_total > v_ref.total - coalesce((
       select sum(total) from sales_docs where ref_doc_id = p_ref and doc_type = 'CN' and status <> 'cancelled'), 0) then
    raise exception 'ยอดใบลดหนี้เกินยอดใบแจ้งหนี้ที่เหลือ';  -- สันนิษฐาน: ป้องกันลดหนี้เกิน
  end if;
  v_status := case p_type when 'QT' then 'pending_approval' when 'INV' then 'awaiting_payment'
                          when 'CA' then 'pending_collect'  when 'CN' then 'approved' else 'active' end;
  insert into sales_docs(id, doc_type, doc_no, doc_date, contact_id, status, price_mode, vat_rate,
                         subtotal, vat, total, ref_doc_id, reason, deposit_net, deposit_vat)
  values (v_id, p_type, next_doc_no(p_type, p_date, true), p_date, v_contact, v_status, p_price_mode, p_vat_rate,
          v_net, v_vat, v_total, p_ref, p_reason, p_deposit_net, p_deposit_vat);
  for l in select * from jsonb_array_elements(p_lines) loop
    n := n + 1;
    insert into sales_doc_lines(doc_id, line_no, description, item_kind, qty, unit_price, amount, product_id, warehouse_id, stock_action)
    values (v_id, n, l->>'description', line_kind(l), (l->>'qty')::numeric,
            (l->>'unit_price')::numeric, round((l->>'qty')::numeric * (l->>'unit_price')::numeric, 2),
            nullif(l->>'product_id','')::uuid, nullif(l->>'warehouse_id','')::uuid, nullif(l->>'stock_action',''));
  end loop;
  if p_type in ('INV','CA','DN') then
    v_rev_cr := '[]'::jsonb;
    if p_type = 'DN' then   -- ใบเพิ่มหนี้ลงรายได้ 41210 ตามต้นแบบ
      v_rev_cr := jsonb_build_array(jsonb_build_object('account','41210','credit',v_net));
    else
      if v_net_goods > 0 then v_rev_cr := v_rev_cr || jsonb_build_object('account','41110','credit',v_net_goods); end if;
      if v_net_serv  > 0 then v_rev_cr := v_rev_cr || jsonb_build_object('account','41210','credit',v_net_serv);  end if;
    end if;
    if v_vat > 0 then v_rev_cr := v_rev_cr || jsonb_build_object('account','27111','credit',v_vat); end if;
    v_lines := jsonb_build_array(jsonb_build_object('account', case p_type when 'CA' then '11319' else '11311' end,
                                                    'debit', v_total))
               || (case when p_deposit_net > 0
                        then jsonb_build_array(jsonb_build_object('account','21921','debit',p_deposit_net))
                        else '[]'::jsonb end)
               || v_rev_cr;
    v_vtype := case p_type when 'CA' then 'RV' else 'SV' end;
  elsif p_type = 'CN' then
    v_lines := jsonb_build_array(jsonb_build_object('account','41400','debit',v_net));
    if v_vat > 0 then v_lines := v_lines || jsonb_build_object('account','27111','debit',v_vat); end if;
    v_lines := v_lines || jsonb_build_object('account','11311','credit',v_total);
    v_vtype := 'SV';
  end if;
  if v_vtype is not null then
    v_voucher := post_voucher(v_vtype, p_date, null, p_type, v_id::text, v_lines);
    update sales_docs set voucher_id = v_voucher where id = v_id;
  end if;
  if p_type in ('INV','CA') then perform stock_issue_for_doc(v_id); end if;
  if p_type in ('CN','DN') then
    for l in select * from jsonb_array_elements(p_lines) loop
      v_act := nullif(l->>'stock_action',''); v_pid := nullif(l->>'product_id','')::uuid;
      if v_pid is null or v_act not in ('return','cut') then continue; end if;
      if not exists (select 1 from products where id = v_pid and kind = 'goods_stock') then continue; end if;
      select warehouse_id into v_wh from sales_doc_lines where doc_id = p_ref and product_id = v_pid limit 1;
      v_wh := coalesce(v_wh, main_warehouse());
      if v_act = 'return' then
        select unit_cost into v_cost from stock_movements
         where doc_id = p_ref and product_id = v_pid and qty_out > 0 and voided_at is null limit 1;   -- ต้นทุนที่ตัดตอนขาย
        v_cost := coalesce(v_cost, product_avg_cost(v_pid));
        perform stock_in(v_pid, v_wh, (l->>'qty')::numeric, round((l->>'qty')::numeric * v_cost, 2),
                         p_date, p_type, v_id, (select doc_no from sales_docs where id = v_id));
      else
        perform stock_out(v_pid, v_wh, (l->>'qty')::numeric, p_date, p_type, v_id, (select doc_no from sales_docs where id = v_id));
      end if;
    end loop;
  end if;
  if p_type = 'DN' then update sales_docs set status = 'awaiting_payment' where id = p_ref; end if;
  return v_id;
end $$;
create or replace function quotation_refresh(p_qt uuid) returns void language plpgsql as $$
declare q sales_docs; v_billed numeric; v_closed numeric; v_bl boolean; v_new text;
begin
  select * into q from sales_docs where id = p_qt and doc_type = 'QT' for update;
  if not found or q.status in ('rejected','cancelled','deposit_paid') then return; end if;
  v_billed := quotation_billed(p_qt);
  select coalesce(sum(amount), 0) into v_closed from quotation_closeouts where qt_id = p_qt and voided_at is null;
  v_bl := exists (select 1 from sales_docs where ref_doc_id = p_qt and doc_type = 'BL' and status <> 'cancelled' and not is_deposit);
  v_new := case when v_closed > 0 or v_bl or v_billed >= q.total - 0.005 then 'converted'
                when v_billed > 0 then 'partial'
                when q.status in ('partial','converted') then 'approved'
                else q.status end;
  if v_new <> q.status then update sales_docs set status = v_new where id = p_qt; end if;
end $$;
create or replace function _make_deposit(q sales_docs, p_type text, p_date date, p_net numeric) returns uuid
language plpgsql as $$
declare v_id uuid := gen_random_uuid(); v_vat numeric; v_total numeric; v uuid; v_ref text;
begin
  v_vat := round(p_net * q.vat_rate / 100, 2); v_total := p_net + v_vat;
  v_ref := 'ใบเสนอราคาเลขที่ ' || q.doc_no || ' มูลค่า ' || to_char(q.total, 'FM999,999,999,990.00') || ' บาท';
  insert into sales_docs(id, doc_type, doc_no, doc_date, contact_id, status, price_mode, vat_rate,
                         subtotal, vat, total, ref_doc_id, is_deposit, internal_note,
                         term_mode, credit_days, due_date, salesperson, project)
  values (v_id, p_type, next_doc_no(p_type, p_date, true), p_date, q.contact_id,
          case p_type when 'INV' then 'awaiting_payment' when 'CA' then 'pending_collect' else 'billed' end,
          'exclusive', q.vat_rate, p_net, v_vat, v_total, q.id, true, 'รับเงินมัดจำ ของ' || v_ref,
          case when p_type = 'CA' then 'cash' else 'credit' end,
          case when p_type = 'CA' then 0 else coalesce(q.credit_days, 0) end,
          case when p_type = 'CA' then null else p_date + coalesce(q.credit_days, 0) end,
          q.salesperson, q.project);
  insert into sales_doc_lines(doc_id, line_no, description, detail, item_kind, qty, unit_price, amount)
  values (v_id, 1, 'รับมัดจำ', v_ref, 'service', 1, p_net, p_net);
  if p_type in ('INV','CA') then
    v := post_voucher(case p_type when 'CA' then 'RV' else 'SV' end, p_date, null, p_type, v_id::text, jsonb_build_array(
          jsonb_build_object('account', case p_type when 'CA' then '11319' else '11311' end, 'debit', v_total),
          jsonb_build_object('account','21921','credit',p_net),
          jsonb_build_object('account','27111','credit',v_vat)));
    update sales_docs set voucher_id = v where id = v_id;
  end if;
  return v_id;
end $$;
create or replace function create_deposit_doc(p_qt uuid, p_kind text, p_date date, p_net numeric) returns uuid
language plpgsql as $$
declare q sales_docs; v_id uuid;
begin
  if p_kind not in ('INV','CA','BL') then raise exception 'ชนิดเอกสารมัดจำ % ไม่ถูกต้อง', p_kind; end if;
  select * into q from sales_docs where id = p_qt and doc_type = 'QT' for update;
  if not found or q.status not in ('pending_approval','approved') then raise exception 'ต้องเป็นใบเสนอราคาที่รออนุมัติหรืออนุมัติแล้วและยังไม่มีมัดจำ'; end if;
  if p_net <= 0 or p_net > q.subtotal then raise exception 'ยอดมัดจำต้องมากกว่า 0 และไม่เกินมูลค่าใบเสนอราคา'; end if;
  v_id := _make_deposit(q, p_kind, p_date, p_net);
  update sales_docs set status = 'deposit_paid' where id = p_qt;
  return v_id;
end $$;
create or replace function create_deposit_invoice(p_qt uuid, p_date date, p_deposit_net numeric) returns uuid
language plpgsql as $$ begin return create_deposit_doc(p_qt, 'INV', p_date, p_deposit_net); end $$;
create or replace function convert_deposit_bl(p_bl uuid, p_date date) returns uuid language plpgsql as $$
declare b sales_docs; q sales_docs; v_id uuid;
begin
  select * into b from sales_docs where id = p_bl and doc_type = 'BL' and is_deposit for update;
  if not found or b.status <> 'billed' then raise exception 'แปลงได้เฉพาะใบวางบิลมัดจำที่ยังรอวางบิล'; end if;
  select * into q from sales_docs where id = b.ref_doc_id and doc_type = 'QT' for update;
  if not found or q.status <> 'deposit_paid' then raise exception 'ใบเสนอราคาต้นทางต้องอยู่ในสถานะมัดจำแล้ว'; end if;
  v_id := _make_deposit(q, 'INV', p_date, b.subtotal);
  update sales_docs set ref_no = b.doc_no where id = v_id;
  update sales_docs set status = 'invoice_opened' where id = p_bl;
  return v_id;
end $$;
drop function if exists create_final_invoice(uuid, date);
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
                           discount_total, exempt_base, deposit_net, deposit_vat)
    values (v_id, 'BL', next_doc_no('BL', p_date, true), p_date, q.contact_id, 'billed', p_qt, q.price_mode, q.vat_rate,
            q.subtotal, q.vat - dep.vat, q.total - dep.total,
            case when q.term_mode = 'cash' then 'credit' else q.term_mode end, case when q.term_mode = 'cash' then 0 else q.credit_days end,
            case when q.term_mode = 'credit' then p_date + q.credit_days end,
            q.salesperson, q.project, q.ref_no, q.description, q.note, q.show_signature, q.discount_total, q.exempt_base,
            dep.subtotal, dep.vat);
    insert into sales_doc_lines(doc_id, line_no, description, detail, item_kind, qty, unit_price, amount, product_id, warehouse_id, unit,
                                discount_type, discount_value, discount, vat_rate, vat_exempt, wht_rate, wht, src_line_no)
      select v_id, line_no, description, detail, item_kind, qty, unit_price, amount, product_id, warehouse_id, unit,
             discount_type, discount_value, discount, vat_rate, vat_exempt, wht_rate, wht, line_no from sales_doc_lines where doc_id = p_qt;
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
