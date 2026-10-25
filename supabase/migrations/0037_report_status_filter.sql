-- M25.1: ตัวกรองสถานะในรายงานยอดขายตามพนักงาน/สินค้า
drop function if exists sales_by_salesperson(date, date);
drop function if exists sales_report_lines(date, date, text);
create function sales_by_salesperson(p_from date, p_to date, p_statuses text[] default null)
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
    and (p_statuses is null or cardinality(p_statuses) = 0 or d.status = any(p_statuses))
  group by 1
  order by 6 desc;
$$;

create function sales_report_lines(p_from date, p_to date, p_type text default null, p_statuses text[] default null)
returns table (doc_id uuid, doc_no text, doc_type text, doc_date date, contact_id uuid, description text, qty numeric, net numeric)
language sql stable as $$
  with x as (
    select d.id, d.doc_no, d.doc_type, d.doc_date, d.contact_id, d.subtotal, d.price_mode, l.line_no, l.description, l.qty, l.amount, l.vat_rate, l.vat_exempt,
           sum(l.amount) over (partition by d.id) tot,
           sum(l.amount) over (partition by d.id order by l.line_no) cum
      from sales_docs d join sales_doc_lines l on l.doc_id = d.id
     where d.doc_type in ('INV','CA','DN','CN') and d.status <> 'cancelled' and not d.is_deposit
       and (p_type is null or d.doc_type = p_type)
       and (p_statuses is null or cardinality(p_statuses) = 0 or d.status = any(p_statuses))
       and (p_from is null or d.doc_date >= p_from) and (p_to is null or d.doc_date <= p_to)
  )
  select id, doc_no, doc_type, doc_date, contact_id, description,
         qty * case when doc_type = 'CN' then -1 else 1 end,
         (case when vat_rate is not null then
                 case when price_mode = 'inclusive' and not coalesce(vat_exempt, false) and vat_rate > 0 then round(amount * 100 / (100 + vat_rate), 2) else amount end
               when tot = 0 then 0
               else round(cum * subtotal / tot, 2) - round((cum - amount) * subtotal / tot, 2) end)
         * case when doc_type = 'CN' then -1 else 1 end
    from x
$$;
