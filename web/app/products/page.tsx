import Link from 'next/link';
import { requirePage } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { getDb } from '@/lib/db';
import { ProductTable } from '@/components/ProductTable';
import { ProductSearch } from '@/components/ProductSearch';
import { productPage } from '@/lib/product-list';
import { ATTR_LABEL, type Attrs } from '@/lib/product-match';
import { KIND_LABEL } from '@/lib/stock-labels';

export const dynamic = 'force-dynamic';
const KICON: Record<string, string> = { service: '🛎', goods_nostock: '📦', goods_stock: '🏷' };
type Sp = { kind?: string; q?: string; wh?: string; cat?: string; mat?: string; hole?: string; thick?: string; sheet?: string; page?: string };
const AK: [keyof Attrs, keyof Sp][] = [['material', 'mat'], ['hole', 'hole'], ['thick', 'thick'], ['sheet', 'sheet']];

export default async function Products({ searchParams }: { searchParams: Sp & { sort?: string; dir?: string } }) {
  const user = await requirePage('master.read');
  const showCost = can(user.role, 'cost.view');
  const kind = KIND_LABEL[searchParams.kind ?? ''] ? searchParams.kind! : '';
  const q = (searchParams.q ?? '').trim();
  const sort = searchParams.sort === 'price' ? 'price' : 'name', dir = searchParams.dir === 'desc' ? 'desc' : 'asc';
  const db = await getDb();
  const whs = await db.q<any>(`select id, name, is_main from warehouses order by is_main desc, code`);
  const wh = whs.some(w => w.id === searchParams.wh) ? searchParams.wh! : '';
  const cat = searchParams.cat ?? '', attr = Object.fromEntries(AK.map(([k, sp]) => [k, searchParams[sp] ?? ''])) as Attrs;
  const pg = await productPage(db, { kind, q, wh, sort, dir, cat, attr, page: Number(searchParams.page) || 1 });
  const rows = pg.rows;
  const base: Record<string, string> = { kind, q, wh, sort, dir, cat, mat: attr.material, hole: attr.hole, thick: attr.thick, sheet: attr.sheet };
  const href = (o: Record<string, string | number>) => { const u = new URLSearchParams(); Object.entries({ ...base, ...o }).forEach(([k, v]) => v && u.set(k, String(v))); return `/products?${u}`; };
  const nextDir = (k: string) => (sort === k && dir === 'asc' ? 'desc' : 'asc');
  const filt = { kind, wh, q };
  return (
    <>
      <div className="top"><div><h1>รายการสินค้า{kind ? KIND_LABEL[kind] : 'ทั้งหมด'}</h1><p className="sub">{pg.total.toLocaleString('th-TH')} รายการ{wh ? ' · แสดงเฉพาะสินค้านับสต็อกที่มีความเคลื่อนไหวในคลังนี้' : ''}</p></div>
        {can(user.role, 'master.write') && <><Link className="btn ghost" href="/products/import">นำเข้ารายการสินค้า</Link><Link className="btn" href="/products/new">+ สร้างใหม่</Link></>}</div>
      <div className="tabs noprint">
        <Link href={href({ kind: '' })} className={kind === '' ? 'on' : ''}>แสดงทั้งหมด</Link>
        {Object.entries(KIND_LABEL).map(([k, l]) => <Link key={k} href={href({ kind: k })} className={kind === k ? 'on' : ''}>{KICON[k]} {l}</Link>)}</div>
      <div className="panel noprint" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <form action="/products">{kind && <input type="hidden" name="kind" value={kind} />}{q && <input type="hidden" name="q" value={q} />}
          <select name="wh" defaultValue={wh} aria-label="คลัง" onChange={undefined}><option value="">คลังทั้งหมด</option>{whs.map(w => <option key={w.id} value={w.id}>{w.name}{w.is_main ? ' (คลังหลัก)' : ''}</option>)}</select>{' '}<button className="btn sm ghost">กรอง</button></form>
        <ProductSearch q={q} base={Object.fromEntries(Object.entries({ ...base, q: '' }).filter(([, v]) => v)) as Record<string, string>} />
      </div>
      {/* M63 ตัวกรองหมวด/คุณสมบัติ (แยกจากชื่อสินค้า) · ส่งฟอร์มแบบ GET คงคำค้นและแท็บไว้ */}
      <form action="/products" className="panel noprint pfilter" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end' }}>
        {Object.entries({ kind, q, wh, sort, dir }).filter(([, v]) => v).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <label className="f">หมวดสินค้า<select name="cat" defaultValue={cat}><option value="">ทั้งหมด</option>
          {pg.cats.map(([c, n]) => <option key={c} value={c}>{c === '-' ? '(ไม่มีหมวด)' : c} ({n})</option>)}</select></label>
        {AK.map(([k, sp]) => pg.facets[k].length > 0 && <label key={k} className="f">{ATTR_LABEL[k]}<select name={sp} defaultValue={attr[k]}><option value="">ทั้งหมด</option>
          {pg.facets[k].map(([v, n]) => <option key={v} value={v}>{v} ({n})</option>)}</select></label>)}
        <button className="btn sm">กรอง</button>
        {(cat || AK.some(([k]) => attr[k])) && <Link className="btn sm ghost" href={href({ cat: '', mat: '', hole: '', thick: '', sheet: '', page: '' })}>ล้างตัวกรอง</Link>}
      </form>
      <ProductTable key={`${kind}|${q}|${wh}|${sort}|${dir}|${cat}|${JSON.stringify(attr)}|${pg.page}`} rows={rows.map(r => ({ ...r, sale_price: Number(r.sale_price), purchase_price: Number(r.purchase_price), onhand: r.onhand == null ? null : Number(r.onhand) }))}
        canWrite={can(user.role, 'master.write')} showCost={showCost} sort={sort} dir={dir}
        sortHref={{ name: href({ sort: 'name', dir: nextDir('name') }), price: href({ sort: 'price', dir: nextDir('price') }) }}
        exportBase={new URLSearchParams(Object.entries({ ...filt, cat, mat: attr.material, hole: attr.hole, thick: attr.thick, sheet: attr.sheet }).filter(([, v]) => v)).toString() + `&sort=${sort}&dir=${dir}`} />
      {pg.pages > 1 && <nav className="pager noprint" aria-label="หน้า" style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 10 }}>
        {Array.from({ length: pg.pages }, (_, i) => i + 1).map(n => <Link key={n} href={href({ page: n })} className={`btn sm ${n === pg.page ? '' : 'ghost'}`} aria-current={n === pg.page ? 'page' : undefined}>{n}</Link>)}
        <span className="sub" style={{ alignSelf: 'center' }}>แสดง {(pg.page - 1) * 100 + 1}–{Math.min(pg.page * 100, pg.total)} จาก {pg.total}</span></nav>}
    </>
  );
}
