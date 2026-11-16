alter table expenses add column created_by uuid references app_users(id);
alter table goods_receipts add column created_by uuid references app_users(id);
alter table purchase_orders add column created_by uuid references app_users(id);
alter table wht_certs add column created_by uuid references app_users(id);
create index on expenses (created_by); create index on goods_receipts (created_by);
create index on purchase_orders (created_by); create index on wht_certs (created_by);
create function purchase_docs_set_creator() returns trigger language plpgsql as $$
begin
  if new.created_by is null then
    new.created_by := nullif(current_setting('app.user_id', true), '')::uuid;
  end if;
  return new;
end $$;
create trigger expenses_set_creator before insert on expenses for each row execute function purchase_docs_set_creator();
create trigger goods_receipts_set_creator before insert on goods_receipts for each row execute function purchase_docs_set_creator();
create trigger purchase_orders_set_creator before insert on purchase_orders for each row execute function purchase_docs_set_creator();
create trigger wht_certs_set_creator before insert on wht_certs for each row execute function purchase_docs_set_creator();
