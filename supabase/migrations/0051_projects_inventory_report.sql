-- M27.6 โปรเจ็ค + รายงานสรุปสินค้าคงเหลือ (REA FA 29-10-2026)
-- โปรเจ็ค: ชื่อ + ลูกค้า/ผู้จำหน่าย (ไม่บังคับ) · เอกสารผูกด้วยชื่อโปรเจ็คในช่อง "โปรเจ็ค" ของเอกสาร
-- รายได้รวม/ค่าใช้จ่ายรวม คิดจากยอดก่อน VAT (ยังไม่ทดสอบกับ FA ว่าก่อนหรือหลัง VAT)
create table projects (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (btrim(name) <> ''),
  contact_id uuid references contacts(id),
  created_at timestamptz not null default now()
);
create function create_project(p_name text, p_contact uuid default null) returns uuid language plpgsql as $$
declare v uuid;
begin
  if coalesce(btrim(p_name), '') = '' then raise exception 'ต้องระบุชื่อโปรเจ็ค'; end if;
  if exists (select 1 from projects where lower(name) = lower(btrim(p_name))) then raise exception 'มีโปรเจ็คชื่อ % แล้ว', btrim(p_name); end if;
  insert into projects(name, contact_id) values (btrim(p_name), p_contact) returning id into v; return v;
end $$;
create function update_project(p_id uuid, p_name text, p_contact uuid default null) returns void language plpgsql as $$
declare o projects;
begin
  select * into o from projects where id = p_id; if not found then raise exception 'ไม่พบโปรเจ็ค'; end if;
  if coalesce(btrim(p_name), '') = '' then raise exception 'ต้องระบุชื่อโปรเจ็ค'; end if;
  if exists (select 1 from projects where lower(name) = lower(btrim(p_name)) and id <> p_id) then raise exception 'มีโปรเจ็คชื่อ % แล้ว', btrim(p_name); end if;
  update projects set name = btrim(p_name), contact_id = p_contact where id = p_id;
  if o.name <> btrim(p_name) then   -- ย้ายชื่อบนเอกสารตาม (ช่องข้อความไม่ใช่ตัวเลข ไม่กระทบบัญชี)
    update sales_docs set project = btrim(p_name) where project = o.name;
    update expenses set project = btrim(p_name) where project = o.name;
    update goods_receipts set project = btrim(p_name) where project = o.name;
    update purchase_orders set project = btrim(p_name) where project = o.name;
  end if;
end $$;
create function delete_project(p_id uuid) returns void language plpgsql as $$
declare o projects;
begin
  select * into o from projects where id = p_id; if not found then raise exception 'ไม่พบโปรเจ็ค'; end if;
  if exists (select 1 from sales_docs where project = o.name) or exists (select 1 from expenses where project = o.name)
     or exists (select 1 from goods_receipts where project = o.name) or exists (select 1 from purchase_orders where project = o.name) then
    raise exception 'โปรเจ็คนี้มีเอกสารอ้างอิงอยู่ ลบไม่ได้';
  end if;
  delete from projects where id = p_id;
end $$;

-- รายได้ = ใบแจ้งหนี้ + ขายสด − ใบลดหนี้ · ค่าใช้จ่าย = ค่าใช้จ่าย + ใบรับสินค้า (ที่ไม่ยกเลิก/ไม่อนุมัติ)
create function project_summary() returns table (id uuid, name text, contact_name text, revenue numeric, expense numeric) language sql stable as $$
  select p.id, p.name, coalesce(c.business_name, c.contact_name),
    coalesce((select sum(case when d.doc_type = 'CN' then -d.subtotal else d.subtotal end) from sales_docs d
               where d.project = p.name and d.doc_type in ('INV','CA','CN') and d.status <> 'cancelled'), 0),
    coalesce((select sum(e.subtotal) from expenses e where e.project = p.name and e.status not in ('cancelled','rejected')), 0)
  + coalesce((select sum(g.subtotal) from goods_receipts g where g.project = p.name and g.status not in ('cancelled','rejected')), 0)
  from projects p left join contacts c on c.id = p.contact_id order by p.name
$$;

-- สรุปสินค้าคงเหลือ ณ วันที่ (ย้อนจาก stock_movements) · p_wh = null → ทุกคลัง · ราคาเฉลี่ย = มูลค่า/จำนวน เมื่อคงเหลือ > 0 มิฉะนั้น 0 (ตาม FA)
create function inventory_summary(p_date date, p_wh uuid default null)
returns table (code text, name text, unit text, qty numeric, avg_cost numeric, value numeric) language sql stable as $$
  select p.code, p.name, p.base_unit, s.q, case when s.q > 0 then round(s.v / s.q, 2) else 0 end, case when s.q > 0 then s.v else 0 end
    from products p
    join (select m.product_id, sum(m.qty_in - m.qty_out) q, sum(case when m.qty_in > 0 then m.value else -m.value end) v
            from stock_movements m where m.voided_at is null and m.move_date <= p_date and (p_wh is null or m.warehouse_id = p_wh)
           group by m.product_id) s on s.product_id = p.id
   where p.kind = 'goods_stock' order by p.code
$$;
