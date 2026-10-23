alter table contacts add column credit_days int not null default 0 check (credit_days >= 0);
alter table sales_docs add column due_date date;
alter table expenses add column due_date date;
alter table goods_receipts add column due_date date;
create function fill_due_date() returns trigger language plpgsql as $$
declare v_date date; v_days int;
begin
  if new.due_date is null then
    v_date := coalesce(to_jsonb(new)->>'doc_date', to_jsonb(new)->>'exp_date', to_jsonb(new)->>'ri_date')::date;
    select credit_days into v_days from contacts where id = (to_jsonb(new)->>'contact_id')::uuid;
    new.due_date := v_date + coalesce(v_days, 0);
  end if;
  return new;
end $$;
create trigger sales_docs_due before insert on sales_docs for each row execute function fill_due_date();
create trigger expenses_due before insert on expenses for each row execute function fill_due_date();
create trigger goods_receipts_due before insert on goods_receipts for each row execute function fill_due_date();
create function set_doc_due(p_kind text, p_id uuid, p_due date) returns void language plpgsql as $$
begin
  if p_kind = 'sales' then update sales_docs set due_date = p_due where id = p_id;
  elsif p_kind = 'expense' then update expenses set due_date = p_due where id = p_id;
  elsif p_kind = 'goods_receipt' then update goods_receipts set due_date = p_due where id = p_id;
  else raise exception 'ชนิดเอกสารไม่ถูกต้อง'; end if;
  if not found then raise exception 'ไม่พบเอกสาร'; end if;
end $$;
create function aging_bucket(p_asof date, p_due date) returns text language sql immutable as $$
  select case when p_asof - p_due <= 0 then 'not_due'
              when p_asof - p_due <= 30 then 'd1_30'
              when p_asof - p_due <= 60 then 'd31_60'
              when p_asof - p_due <= 90 then 'd61_90'
              else 'over90' end
$$;
create function contact_label(p_id uuid) returns text language sql stable as $$
  select coalesce(nullif(btrim(business_name), ''), contact_name) from contacts where id = p_id
$$;
create function ar_aging(p_asof date, p_contact uuid default null)
returns table (contact_id uuid, contact_name text, doc_id uuid, doc_no text, doc_type text, doc_date date, due_date date,
               receipt_refs text, doc_total numeric, receipted numeric, collected numeric, credit_notes numeric,
               outstanding numeric, bucket text, not_due numeric, d1_30 numeric, d31_60 numeric, d61_90 numeric, over90 numeric)
language sql stable as $$
  with base as (
    select d.*, 
      coalesce((select sum(ri.amount) from receipt_items ri join receipts r on r.id = ri.receipt_id
                 where ri.doc_id = d.id and r.status <> 'cancelled'), 0) as receipted,
      coalesce((select sum(ri.amount) from receipt_items ri join receipts r on r.id = ri.receipt_id
                 where ri.doc_id = d.id and r.status = 'collected' and coalesce(r.collected_date, r.receipt_date) <= p_asof), 0) as collected,
      coalesce((select sum(c.total) from sales_docs c where c.ref_doc_id = d.id and c.doc_type = 'CN'
                 and c.status <> 'cancelled' and c.doc_date <= p_asof), 0) as cn,
      (select string_agg(distinct r.receipt_no, ',' order by r.receipt_no) from receipt_items ri join receipts r on r.id = ri.receipt_id
        where ri.doc_id = d.id and r.status <> 'cancelled') as refs
    from sales_docs d
    where d.doc_date <= p_asof and (p_contact is null or d.contact_id = p_contact)
      and ((d.doc_type in ('INV','DN') and d.status <> 'cancelled')
           or (d.doc_type = 'CA' and d.status = 'pending_collect'))
  ), x as (
    select b.*, b.total - b.cn - b.collected as out from base b
  )
  select x.contact_id, contact_label(x.contact_id), x.id, x.doc_no, x.doc_type, x.doc_date, x.due_date,
         x.refs, x.total, x.receipted, x.collected, x.cn, x.out, aging_bucket(p_asof, x.due_date),
         case when aging_bucket(p_asof, x.due_date) = 'not_due' then x.out else 0 end,
         case when aging_bucket(p_asof, x.due_date) = 'd1_30'   then x.out else 0 end,
         case when aging_bucket(p_asof, x.due_date) = 'd31_60'  then x.out else 0 end,
         case when aging_bucket(p_asof, x.due_date) = 'd61_90'  then x.out else 0 end,
         case when aging_bucket(p_asof, x.due_date) = 'over90'  then x.out else 0 end
    from x where x.out > 0
   order by contact_label(x.contact_id), x.doc_date, x.doc_no
$$;
create function ap_aging(p_asof date, p_contact uuid default null)
returns table (contact_id uuid, contact_name text, doc_id uuid, doc_no text, doc_type text, doc_date date, due_date date,
               doc_total numeric, outstanding numeric, bucket text, liability_account text,
               not_due numeric, d1_30 numeric, d31_60 numeric, d61_90 numeric, over90 numeric)
language sql stable as $$
  with x as (
    select e.contact_id, e.id, e.exp_no as doc_no, 'EXP'::text as doc_type, e.exp_date as doc_date, e.due_date,
           e.total, '21399'::text as acct
      from expenses e where e.status in ('pending','approved') and e.exp_date <= p_asof
    union all
    select g.contact_id, g.id, g.ri_no, 'RI', g.ri_date, g.due_date, g.total, '21311'
      from goods_receipts g where g.status = 'unpaid' and g.ri_date <= p_asof
  )
  select x.contact_id, contact_label(x.contact_id), x.id, x.doc_no, x.doc_type, x.doc_date, x.due_date,
         x.total, x.total, aging_bucket(p_asof, x.due_date), x.acct,
         case when aging_bucket(p_asof, x.due_date) = 'not_due' then x.total else 0 end,
         case when aging_bucket(p_asof, x.due_date) = 'd1_30'   then x.total else 0 end,
         case when aging_bucket(p_asof, x.due_date) = 'd31_60'  then x.total else 0 end,
         case when aging_bucket(p_asof, x.due_date) = 'd61_90'  then x.total else 0 end,
         case when aging_bucket(p_asof, x.due_date) = 'over90'  then x.total else 0 end
    from x where (p_contact is null or x.contact_id = p_contact)
   order by contact_label(x.contact_id), x.doc_date, x.doc_no
$$;
