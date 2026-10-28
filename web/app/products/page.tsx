import Link from 'next/link';
import { requirePage } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { getDb } from '@/lib/db';
import { ProductTable } from '@/components/ProductTable';
import { ProductSearch } from '@/components/ProductSearch';
import { productQuery } from '@/lib/product-list';
import { KIND_LABEL } from '@/lib/stock-labels';

export const dynamic = 'force-dynamic';
const KICON: Record<string, string> = { service: '🛎', goods_nostock: '📦', goods_stock: '🏷' };
type Sp = { kind?: string; q?: string; wh?: string };

export default async function Products({ searchParams }: { searchParams: Sp & { sort?: string; dir?: string } }) {
  const user = await requirePage('master.read');
  const showCost = can(user.role, 'cost.view');
  const kind = KIND_LABEL[searchParams.kind ?? ''] ? searchParams.kind! : '';
  const q = (searchParams.q ?? '').trim();
  const sort = searchParams.sort === 'price' ? 'price' : 'name', dir = searchParams.dir === 'desc' ? 'desc' : 'asc';
  const db = await getDb();
  const whs = await db.q<any>(`select id, name, is_main from warehouses order by is_main desc, code`);
  const wh = whs.some(w => w.id === searchParams.wh) ? searchParams.wh! : '';
  const rows = await productQuery(db, { kind, q, wh, sort, dir });
  const base = { kind, q, wh, sort, dir };
  const href = (o: Record<string, string>) => { const u = new URLSearchParams(); Object.entries({ ...base, ...o }).forEach(([k, v]) => v && u.set(k, String(v))); return `/products?${u}`; };
  const nextDir = (k: string) => (sort === k && dir === 'asc' ? 'desc' : 'asc');
  const filt = { kind, wh, q };
  return (
    <>
      <div className="top"><div><h1>รายการสินค้า{kind ? KIND_LABEL[kind] : 'ทั้งหมด'}</h1><p className="sub">{rows.length} รายการ{wh ? ' · แสดงเฉพาะสินค้านับสต็อกที่มีความเคลื่อนไหวในคลังนี้' : ''}</p></div>
        {can(user.role, 'master.write') && <><Link className="btn ghost" href="/products/import">นำเข้ารายการสินค้า</Link><Link className="btn" href="/products/new">+ สร้างใหม่</Link></>}</div>
      <div className="tabs noprint">
        <Link href={href({ kind: '' })} className={kind === '' ? 'on' : ''}>แสดงทั้งหมด</Link>
        {Object.entries(KIND_LABEL).map(([k, l]) => <Link key={k} href={href({ kind: k })} className={kind === k ? 'on' : ''}>{KICON[k]} {l}</Link>)}</div>
      <div className="panel noprint" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <form action="/products">{kind && <input type="hidden" name="kind" value={kind} />}{q && <input type="hidden" name="q" value={q} />}
          <select name="wh" defaultValue={wh} aria-label="คลัง" onChange={undefined}><option value="">คลังทั้งหมด</option>{whs.map(w => <option key={w.id} value={w.id}>{w.name}{w.is_main ? ' (คลังหลัก)' : ''}</option>)}</select>{' '}<button className="btn sm ghost">กรอง</button></form>
        <ProductSearch q={q} base={{ ...(kind ? { kind } : {}), ...(wh ? { wh } : {}), sort, dir }} />
      </div>
      <ProductTable key={`${kind}|${q}|${wh}|${sort}|${dir}`} rows={rows.map(r => ({ ...r, sale_price: Number(r.sale_price), purchase_price: Number(r.purchase_price), onhand: r.onhand == null ? null : Number(r.onhand) }))}
        canWrite={can(user.role, 'master.write')} showCost={showCost} sort={sort} dir={dir}
        sortHref={{ name: href({ sort: 'name', dir: nextDir('name') }), price: href({ sort: 'price', dir: nextDir('price') }) }}
        exportBase={new URLSearchParams(Object.entries(filt).filter(([, v]) => v)).toString() + `&sort=${sort}&dir=${dir}`} />
    </>
  );
}
