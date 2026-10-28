// คำสั่งค้นหารายการสินค้า (ใช้ร่วมกันระหว่างหน้ารายการ, ส่งออก Excel, ค้นหาแนะนำ)
export type PQ = { kind?: string; q?: string; wh?: string; sort?: string; dir?: string; ids?: string[]; limit?: number };
export async function productQuery(db: { q: <T = any>(sql: string, a?: unknown[]) => Promise<T[]> }, f: PQ) {
  const sortCol = f.sort === 'price' ? 'p.sale_price' : 'lower(p.name)';
  const dir = f.dir === 'desc' ? 'desc' : 'asc';
  return db.q<any>(`select p.*, case when p.kind='goods_stock' then coalesce((select sum(qty_in-qty_out) from stock_movements m where m.product_id=p.id and m.voided_at is null and ($3='' or m.warehouse_id=$3::uuid)),0) end onhand,
      (select string_agg(u.unit || '|' || u.factor, ';') from product_units u where u.product_id=p.id) units
    from products p
    where ($1='' or p.kind=$1) and ($2='' or p.name ilike '%'||$2||'%' or p.code ilike '%'||$2||'%' or p.barcode ilike '%'||$2||'%')
      and (cardinality($4::uuid[])=0 or p.id = any($4::uuid[]))
      and ($3='' or (p.kind='goods_stock' and exists (select 1 from stock_movements m where m.product_id=p.id and m.warehouse_id=$3::uuid and m.voided_at is null)))
    order by ${sortCol} ${dir}, p.code ${f.limit ? `limit ${Math.min(50, f.limit)}` : ''}`, [f.kind ?? '', f.q ?? '', f.wh ?? '', f.ids ?? []]);
}
