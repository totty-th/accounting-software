create function ar_aging_bl(p_asof date, p_contact uuid default null)
returns table (contact_id uuid, contact_name text, doc_id uuid, doc_no text, doc_type text, doc_date date, due_date date,
               receipt_refs text, doc_total numeric, receipted numeric, collected numeric, credit_notes numeric,
               outstanding numeric, bucket text, not_due numeric, d1_30 numeric, d31_60 numeric, d61_90 numeric, over90 numeric)
language sql stable as $$
  select b.contact_id, contact_label(b.contact_id), b.id, b.doc_no, b.doc_type, b.doc_date, b.due_date, null::text,
         b.total, 0::numeric, 0::numeric, 0::numeric, b.total, aging_bucket(p_asof, b.due_date),
         case when aging_bucket(p_asof, b.due_date) = 'not_due' then b.total else 0 end,
         case when aging_bucket(p_asof, b.due_date) = 'd1_30'   then b.total else 0 end,
         case when aging_bucket(p_asof, b.due_date) = 'd31_60'  then b.total else 0 end,
         case when aging_bucket(p_asof, b.due_date) = 'd61_90'  then b.total else 0 end,
         case when aging_bucket(p_asof, b.due_date) = 'over90'  then b.total else 0 end
    from sales_docs b
   where b.doc_type = 'BL' and b.status <> 'cancelled' and b.doc_date <= p_asof and b.total > 0
     and (p_contact is null or b.contact_id = p_contact)
     and not exists (select 1 from billing_note_items i where i.billing_id = b.id)
     and not exists (select 1 from sales_docs c where c.ref_doc_id = b.id and c.status <> 'cancelled')
$$;
