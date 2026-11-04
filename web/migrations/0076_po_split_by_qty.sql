alter table goods_receipts drop constraint goods_receipts_split_mode_check;
alter table goods_receipts add constraint goods_receipts_split_mode_check check (split_mode in ('percent','amount','qty'));
create function po_line_billed_qty(p_po uuid, p_line int) returns numeric language sql stable as $$
  select coalesce(sum(g.qty), 0) from goods_receipt_lines g join goods_receipts r on r.id = g.ri_id
   where r.po_id = p_po and r.split_mode = 'qty' and r.status not in ('cancelled','rejected') and g.line_no = p_line
$$;
create function split_ri_from_po_qty(p_po uuid, p_date date, p_qtys jsonb) returns uuid
language plpgsql as $$
declare po purchase_orders; l purchase_order_lines; q jsonb; v_id uuid := gen_random_uuid(); v_no text; v uuid;
        t_net numeric := 0; t_vat numeric := 0; n_net numeric; n_vat numeric; n int := 0; v_qty numeric; v_done numeric;
        v_lines jsonb; v_any boolean := false;
begin
  select * into po from purchase_orders where id = p_po for update;
  if not found or po.status not in ('approved','partial') then raise exception 'แบ่งจ่ายได้เฉพาะใบสั่งซื้อที่อนุมัติแล้ว'; end if;
  if exists (select 1 from goods_receipts where po_id = p_po and split_mode in ('percent','amount') and status not in ('cancelled','rejected')) then
    raise exception 'ใบสั่งซื้อนี้แบ่งจ่ายแบบ % / จำนวนเงินไปแล้ว แบ่งตามจำนวนสินค้าซ้ำไม่ได้', '%';
  end if;
  if jsonb_typeof(p_qtys) <> 'array' then raise exception 'รูปแบบจำนวนไม่ถูกต้อง'; end if;
  v_no := next_doc_no('RI', p_date, true);
  insert into goods_receipts(id, ri_no, ri_date, contact_id) values (v_id, v_no, p_date, po.contact_id);
  for l in select * from purchase_order_lines where po_id = p_po order by line_no loop
    select coalesce(sum((x->>'qty')::numeric), 0) into v_qty from jsonb_array_elements(p_qtys) x where (x->>'line_no')::int = l.line_no;
    if v_qty < 0 then raise exception 'จำนวนต้องไม่ติดลบ'; end if;
    if v_qty = 0 then continue; end if;
    v_done := po_line_billed_qty(p_po, l.line_no);
    if v_done + v_qty > l.qty then
      raise exception 'บรรทัดที่ % แบ่งเกินจำนวนคงเหลือ (เหลือ %)', l.line_no, l.qty - v_done;
    end if;
    if v_done + v_qty = l.qty then  -- ครบบรรทัด: รับส่วนที่เหลือทั้งหมด กันเศษปัด
      n_net := l.net - coalesce((select sum(g.net) from goods_receipt_lines g join goods_receipts r on r.id = g.ri_id
          where r.po_id = p_po and r.split_mode = 'qty' and r.status not in ('cancelled','rejected') and g.line_no = l.line_no), 0);
      n_vat := l.vat - coalesce((select sum(g.vat) from goods_receipt_lines g join goods_receipts r on r.id = g.ri_id
          where r.po_id = p_po and r.split_mode = 'qty' and r.status not in ('cancelled','rejected') and g.line_no = l.line_no), 0);
    else
      n_net := round(l.net * v_qty / l.qty, 2); n_vat := round(l.vat * v_qty / l.qty, 2);
    end if;
    n := n + 1; v_any := true;
    insert into goods_receipt_lines(ri_id, line_no, product_id, warehouse_id, qty, unit_price, vat_rate, net, vat, description, unit, vat_exempt)
    values (v_id, l.line_no, l.product_id, coalesce(l.warehouse_id, po.warehouse_id, main_warehouse()), v_qty, l.unit_price, l.vat_rate, n_net, n_vat,
            l.description, l.unit, l.vat_exempt);
    t_net := t_net + n_net; t_vat := t_vat + n_vat;
    perform stock_in(l.product_id, coalesce(l.warehouse_id, po.warehouse_id, main_warehouse()), v_qty, n_net, p_date, 'RI', v_id, v_no);
  end loop;
  if not v_any then raise exception 'ต้องระบุจำนวนที่แบ่งอย่างน้อย 1 บรรทัด'; end if;
  v_lines := jsonb_build_array(jsonb_build_object('account', sys_account('inventory'), 'debit', t_net));
  if t_vat > 0 then v_lines := v_lines || jsonb_build_object('account','17113','debit',t_vat); end if;
  v_lines := v_lines || jsonb_build_object('account','21311','credit', t_net + t_vat);
  v := post_voucher('UV', p_date, null, 'RI', v_id::text, v_lines);
  update goods_receipts set subtotal = t_net, vat = t_vat, total = t_net + t_vat, uv_voucher_id = v, po_id = p_po, ref_no = po.po_no,
      credit_days = po.credit_days, due_date = coalesce(po.due_date, p_date), purchaser = po.purchaser, project = po.project,
      description = po.description, price_mode = po.price_mode, warehouse_id = po.warehouse_id, note = po.note,
      split_mode = 'qty', split_value = null, stock_in_done = true
    where id = v_id;
  perform po_recompute_qty_status(p_po);
  return v_id;
end $$;
create function po_recompute_qty_status(p_po uuid) returns void language plpgsql as $$
declare po purchase_orders; v_any boolean; v_open boolean;
begin
  select * into po from purchase_orders where id = p_po for update;
  if not found or po.status not in ('approved','partial','converted') then return; end if;
  select exists (select 1 from goods_receipts where po_id = p_po and split_mode = 'qty' and status not in ('cancelled','rejected')) into v_any;
  if not v_any then
    if exists (select 1 from goods_receipts where po_id = p_po and split_mode = 'qty') then
      update purchase_orders set status = 'approved' where id = p_po;
    end if;
    return;
  end if;
  select exists (select 1 from purchase_order_lines l where l.po_id = p_po and po_line_billed_qty(p_po, l.line_no) < l.qty) into v_open;
  update purchase_orders set status = case when v_open then 'partial' else 'converted' end where id = p_po;
end $$;
create function trg_ri_qty_status() returns trigger language plpgsql as $$
begin
  if new.split_mode = 'qty' and new.po_id is not null and new.status is distinct from old.status then
    perform po_recompute_qty_status(new.po_id);
  end if;
  return new;
end $$;
create trigger ri_qty_status after update of status on goods_receipts
  for each row execute function trg_ri_qty_status();
create function trg_ri_split_mode_guard() returns trigger language plpgsql as $$
begin
  if new.split_mode in ('percent','amount') and new.po_id is not null and exists (
       select 1 from goods_receipts where po_id = new.po_id and split_mode = 'qty' and status not in ('cancelled','rejected')) then
    raise exception 'ใบสั่งซื้อนี้แบ่งตามจำนวนสินค้าไปแล้ว แบ่งแบบ % / จำนวนเงินซ้ำไม่ได้', '%';
  end if;
  return new;
end $$;
create trigger ri_split_mode_guard before update of split_mode on goods_receipts
  for each row execute function trg_ri_split_mode_guard();
