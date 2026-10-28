create table product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  pos int not null default 0,
  name text not null,
  mime text not null check (mime in ('image/jpeg','image/png','image/webp')),
  data bytea not null,
  created_at timestamptz not null default now()
);
create index product_images_product on product_images(product_id, pos);
create function add_product_image(p_product uuid, p_name text, p_mime text, p_data bytea) returns uuid language plpgsql as $$
declare v_id uuid;
begin
  if not exists (select 1 from products where id = p_product) then raise exception 'ไม่พบสินค้า'; end if;
  if p_mime not in ('image/jpeg','image/png','image/webp') then raise exception 'รองรับเฉพาะรูป JPG, PNG, WEBP'; end if;
  if p_data is null or length(p_data) = 0 then raise exception 'ไม่พบไฟล์รูป'; end if;
  if length(p_data) > 5 * 1024 * 1024 then raise exception 'รูปใหญ่เกิน 5 MB'; end if;
  if (select count(*) from product_images where product_id = p_product) >= 10 then raise exception 'อัปโหลดรูปได้สูงสุด 10 รูปต่อสินค้า'; end if;
  insert into product_images(product_id, pos, name, mime, data)
  values (p_product, coalesce((select max(pos) + 1 from product_images where product_id = p_product), 0), left(p_name, 50), p_mime, p_data)
  returning id into v_id;
  return v_id;
end $$;
create function delete_product_image(p_id uuid) returns void language plpgsql as $$
begin delete from product_images where id = p_id; if not found then raise exception 'ไม่พบรูปสินค้า'; end if; end $$;
create function set_product_image_order(p_product uuid, p_ids uuid[]) returns void language plpgsql as $$
begin
  update product_images i set pos = o.n - 1 from unnest(p_ids) with ordinality as o(id, n) where i.id = o.id and i.product_id = p_product;
  update product_images i set pos = r.n + coalesce(array_length(p_ids, 1), 0) - 1
    from (select id, row_number() over (order by pos) n from product_images where product_id = p_product and id <> all (coalesce(p_ids, '{}'))) r
   where i.id = r.id;
end $$;
