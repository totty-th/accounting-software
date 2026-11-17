// คำสั่งค้นหารายการสินค้า (ใช้ร่วมกันระหว่างหน้ารายการ, ส่งออก Excel, ค้นหาแนะนำ)
// M63: ค้นหาหลายคำ (lib/product-match) + กรองหมวด/คุณสมบัติ + แบ่งหน้า — กรองในหน่วยความจำจากข้อมูลย่อ แล้วดึงรายละเอียดเฉพาะหน้าที่แสดง
import { matcher, hayOf, attrOk, facets, type Attrs } from './product-match';

type Db = { q: <T = any>(sql: string, a?: unknown[]) => Promise<T[]> };
export type PQ = { kind?: string; q?: string; wh?: string; sort?: string; dir?: string; ids?: string[]; limit?: number; cat?: string; attr?: Partial<Attrs> };

const DETAIL = `select p.*, case when p.kind='goods_stock' then coalesce((select sum(qty_in-qty_out) from stock_movements m where m.product_id=p.id and m.voided_at is null and ($2='' or m.warehouse_id=$2::uuid)),0) end onhand,
      (select i.id from product_images i where i.product_id=p.id order by i.pos limit 1) img,
      (select string_agg(u.unit || '|' || u.factor, ';') from product_units u where u.product_id=p.id) units
    from products p where p.id = any($1::uuid[])`;

/** รายการสินค้าที่ผ่านตัวกรอง (ข้อมูลย่อ เรียงแล้ว) */
async function filtered(db: Db, f: PQ) {
  const light = await db.q<any>(`select p.id, p.code, p.name, p.category, p.barcode, p.sale_price from products p
     where ($1='' or p.kind=$1) and (cardinality($2::uuid[])=0 or p.id = any($2::uuid[]))
       and ($3='' or (p.kind='goods_stock' and exists (select 1 from stock_movements m where m.product_id=p.id and m.warehouse_id=$3::uuid and m.voided_at is null)))`,
    [f.kind ?? '', f.ids ?? [], f.wh ?? '']);
  const m = matcher(f.q ?? '');
  const searched = light.filter(p => m(hayOf(p)));
  const base = searched.filter(p => !f.cat || (f.cat === '-' ? !p.category : p.category === f.cat));
  const rows = base.filter(p => attrOk(p.name, f.attr ?? {}));
  const d = f.dir === 'desc' ? -1 : 1;
  rows.sort((a, b) => d * (f.sort === 'price' ? Number(a.sale_price) - Number(b.sale_price) : a.name.localeCompare(b.name, 'th')) || a.code.localeCompare(b.code));
  return { rows, base, searched };
}
async function detail(db: Db, ids: string[], wh = '') {
  if (!ids.length) return [];
  const by = new Map((await db.q<any>(DETAIL, [ids, wh])).map(r => [r.id, r]));
  return ids.map(id => by.get(id)).filter(Boolean);
}

export async function productQuery(db: Db, f: PQ) {
  const { rows } = await filtered(db, f);
  return detail(db, rows.slice(0, f.limit ? Math.min(50, f.limit) : undefined).map(r => r.id), f.wh ?? '');
}

/** หน้ารายการสินค้า: แบ่งหน้า + ตัวเลือกตัวกรอง (หมวด/คุณสมบัติ นับจากชุดที่ค้นหาแล้ว) */
export async function productPage(db: Db, f: PQ & { page?: number; per?: number }) {
  const per = f.per ?? 100;
  const { rows, base, searched } = await filtered(db, f);
  const pages = Math.max(1, Math.ceil(rows.length / per)), page = Math.min(Math.max(1, f.page ?? 1), pages);
  const cats = new Map<string, number>();
  for (const p of searched) cats.set(p.category ?? '-', (cats.get(p.category ?? '-') ?? 0) + 1);
  return { rows: await detail(db, rows.slice((page - 1) * per, page * per).map(r => r.id), f.wh ?? ''), total: rows.length, page, pages,
    cats: [...cats.entries()].sort((a, b) => b[1] - a[1]),
    // ตัวเลือกของแต่ละคุณสมบัติ นับโดยไม่รวมตัวกรองของคุณสมบัตินั้นเอง (เปลี่ยนค่าได้โดยไม่ต้องล้างก่อน)
    facets: Object.fromEntries((['material', 'hole', 'thick', 'sheet'] as const).map(k => [k, facets(base.filter(p => attrOk(p.name, { ...f.attr, [k]: '' })))[k]])) as ReturnType<typeof facets> };
}
