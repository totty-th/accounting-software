create table purchase_doc_events (
  id        bigserial primary key,
  doc_type  text not null check (doc_type in ('PO','RI','EXP')),
  doc_id    uuid not null,
  event     text not null check (event in ('created','status','edit')),
  detail    text,
  actor_id  uuid references app_users(id),
  tx        bigint not null default txid_current(),
  at        timestamptz not null default now()
);
create index on purchase_doc_events (doc_type, doc_id, id);
create function reject_change_purchase_doc_events() returns trigger language plpgsql as $$
begin raise exception 'ประวัติเอกสารแก้ไขหรือลบไม่ได้'; end $$;
create trigger purchase_doc_events_ro before update or delete on purchase_doc_events
  for each row execute function reject_change_purchase_doc_events();
create function purchase_doc_event_log() returns trigger language plpgsql as $$
declare k text := tg_argv[0]; d_old date; d_new date; parts text[] := '{}';
begin
  if tg_op = 'INSERT' then
    insert into purchase_doc_events(doc_type, doc_id, event, detail, actor_id) values (k, new.id, 'created', new.status, doc_event_actor());
    return new;
  end if;
  if new.status is distinct from old.status then
    insert into purchase_doc_events(doc_type, doc_id, event, detail, actor_id) values (k, new.id, 'status', old.status || '>' || new.status, doc_event_actor());
  end if;
  if exists (select 1 from purchase_doc_events where doc_type = k and doc_id = new.id and event = 'created' and tx = txid_current()) then return new; end if;
  d_old := case k when 'PO' then (to_jsonb(old)->>'po_date')::date when 'RI' then (to_jsonb(old)->>'ri_date')::date else (to_jsonb(old)->>'exp_date')::date end;
  d_new := case k when 'PO' then (to_jsonb(new)->>'po_date')::date when 'RI' then (to_jsonb(new)->>'ri_date')::date else (to_jsonb(new)->>'exp_date')::date end;
  if d_new is distinct from d_old then parts := parts || ('วันที่ ' || to_char(d_old, 'DD/MM/YYYY') || ' → ' || to_char(d_new, 'DD/MM/YYYY')); end if;
  if new.contact_id is distinct from old.contact_id then
    parts := parts || ('ผู้จำหน่าย ' || coalesce(contact_label(old.contact_id), '-') || ' → ' || coalesce(contact_label(new.contact_id), '-'));
  end if;
  if new.total is distinct from old.total then
    parts := parts || ('ยอดรวม ' || to_char(old.total, 'FM999,999,999,990.00') || ' → ' || to_char(new.total, 'FM999,999,999,990.00'));
  end if;
  if array_length(parts, 1) > 0 then
    insert into purchase_doc_events(doc_type, doc_id, event, detail, actor_id) values (k, new.id, 'edit', array_to_string(parts, ' · '), doc_event_actor());
  end if;
  return new;
end $$;
create trigger po_events after insert or update on purchase_orders for each row execute function purchase_doc_event_log('PO');
create trigger ri_events after insert or update on goods_receipts for each row execute function purchase_doc_event_log('RI');
create trigger exp_events after insert or update on expenses for each row execute function purchase_doc_event_log('EXP');
