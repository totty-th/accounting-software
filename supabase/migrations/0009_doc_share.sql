-- M9: ลิงก์แชร์เอกสารขาย (เปิดดูได้โดยไม่ต้องล็อกอิน) และข้อมูลสำหรับหน้ารายละเอียด/พิมพ์
alter table sales_docs add column share_token text unique;

-- สร้างรหัสลิงก์ครั้งแรกที่ขอ แล้วใช้รหัสเดิมตลอด (รหัสสุ่ม 26 ตัว จาก gen_random_uuid)
create function ensure_share_token(p_id uuid) returns text language plpgsql as $$
declare v text;
begin
  select share_token into v from sales_docs where id = p_id for update;
  if not found then raise exception 'ไม่พบเอกสาร'; end if;
  if v is null then
    v := substr(replace(gen_random_uuid()::text, '-', ''), 1, 26);
    update sales_docs set share_token = v where id = p_id;
  end if;
  return v;
end $$;

-- ยกเลิกลิงก์เดิม (รหัสใหม่จะถูกสร้างเมื่อขอครั้งถัดไป)
create function revoke_share_token(p_id uuid) returns void language sql as $$
  update sales_docs set share_token = null where id = p_id;
$$;

create function sales_doc_by_token(p_token text) returns uuid language sql stable as $$
  select id from sales_docs where share_token = p_token and p_token is not null;
$$;

-- ข้อมูลทั้งหมดที่ใช้แสดงเอกสาร (หน้าจอ / พิมพ์ / PDF / ลิงก์แชร์)
create function sales_doc_view(p_id uuid) returns jsonb language plpgsql stable as $$
declare d sales_docs; c contacts; v jsonb;
begin
  select * into d from sales_docs where id = p_id;
  if not found then raise exception 'ไม่พบเอกสาร'; end if;
  select * into c from contacts where id = d.contact_id;
  select jsonb_build_object(
    'doc', jsonb_build_object('id', d.id, 'doc_type', d.doc_type, 'doc_no', d.doc_no, 'doc_date', d.doc_date,
      'due_date', d.due_date, 'status', d.status, 'price_mode', d.price_mode, 'vat_rate', d.vat_rate,
      'subtotal', d.subtotal, 'vat', d.vat, 'total', d.total, 'reason', d.reason, 'is_deposit', d.is_deposit,
      'deposit_net', d.deposit_net, 'deposit_vat', d.deposit_vat, 'wht_rate', d.wht_rate),
    'contact', jsonb_build_object('id', c.id, 'name', coalesce(nullif(c.business_name,''), c.contact_name),
      'address', c.address, 'tax_id', c.tax_id, 'credit_days', c.credit_days),
    'company', (select jsonb_build_object('name', name, 'address', address, 'tax_id', tax_id) from company_profile limit 1),
    'lines', coalesce((select jsonb_agg(jsonb_build_object('line_no', line_no, 'description', description,
        'item_kind', item_kind, 'qty', qty, 'unit_price', unit_price, 'amount', amount) order by line_no)
      from sales_doc_lines where doc_id = d.id), '[]'::jsonb),
    'ref', (select jsonb_build_object('id', r.id, 'doc_no', r.doc_no, 'doc_type', r.doc_type) from sales_docs r where r.id = d.ref_doc_id),
    'children', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'doc_no', x.doc_no, 'doc_type', x.doc_type, 'status', x.status)
        order by x.doc_date, x.doc_no) from sales_docs x where x.ref_doc_id = d.id), '[]'::jsonb),
    'receipts', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'receipt_no', r.receipt_no, 'status', r.status,
        'receipt_date', r.receipt_date, 'collected_date', r.collected_date, 'amount', ri.amount) order by r.receipt_date, r.receipt_no)
      from receipt_items ri join receipts r on r.id = ri.receipt_id where ri.doc_id = d.id and r.status <> 'cancelled'), '[]'::jsonb),
    'vouchers', coalesce((select jsonb_agg(jsonb_build_object('id', j.id, 'voucher_no', j.voucher_no))
      from journal_vouchers j where j.id in (d.voucher_id, d.collect_voucher_id)), '[]'::jsonb)
  ) into v;
  return v;
end $$;
