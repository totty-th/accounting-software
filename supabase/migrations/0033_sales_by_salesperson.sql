-- M21 ยอดขายตามพนักงาน (ต้นแบบ: กลุ่มตามพนักงานขาย, ขยายดูลูกค้า/เอกสารได้)
-- กติกาเดียวกับ sales_revenue_reconcile: ไม่รวมยกเลิก/ใบมัดจำ, CN เป็นลบ, ยอดก่อน VAT
-- ผลรวมทุกกลุ่ม = sales_revenue_reconcile(...).doc.total เสมอ (ทดสอบใน m21)
create or replace function sales_by_salesperson(p_from date, p_to date)
returns table (salesperson text, doc_count int, customer_count int, sub numeric, vat numeric, total numeric)
language sql stable as $$
  select coalesce(nullif(btrim(d.salesperson), ''), 'ไม่ระบุพนักงาน'),
         count(*)::int, count(distinct d.contact_id)::int,
         sum(d.subtotal * case when d.doc_type = 'CN' then -1 else 1 end)::numeric(18,2),
         sum(d.vat      * case when d.doc_type = 'CN' then -1 else 1 end)::numeric(18,2),
         sum(d.total    * case when d.doc_type = 'CN' then -1 else 1 end)::numeric(18,2)
  from sales_docs d
  where d.status <> 'cancelled' and not d.is_deposit and d.doc_type in ('INV','CA','CN','DN')
    and (p_from is null or d.doc_date >= p_from) and (p_to is null or d.doc_date <= p_to)
  group by 1
  order by 6 desc;
$$;
