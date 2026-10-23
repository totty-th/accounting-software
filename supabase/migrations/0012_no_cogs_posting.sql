-- M12: ตามต้นแบบ ใบแจ้งหนี้/ขายสดตัดสต็อก (จำนวน+มูลค่าสต็อก) แต่ไม่ลงรายการบัญชีต้นทุนขาย/สินค้าคงเหลือ
-- (ต้นแบบไม่มีรายการต้นทุนในทุกเอกสารขาย) ตัดสินใจโดยเจ้าของระบบ 23-10-2026 — ทบทวนภายหลังได้
create or replace function stock_issue_for_doc(p_doc uuid) returns void language plpgsql as $$
declare d sales_docs; l record; v_cogs numeric;
begin
  select * into d from sales_docs where id = p_doc;
  for l in select sl.* from sales_doc_lines sl join products p on p.id = sl.product_id
            where sl.doc_id = p_doc and p.kind = 'goods_stock' order by sl.line_no loop
    v_cogs := stock_out(l.product_id, coalesce(l.warehouse_id, main_warehouse()), l.qty,
                        d.doc_date, d.doc_type, d.id, d.doc_no);
  end loop;
end $$;
