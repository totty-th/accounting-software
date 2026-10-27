import Link from 'next/link';
import { requirePage } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { getDb } from '@/lib/db';
import { money, qty } from '@/lib/format';
import { KIND_LABEL } from '@/lib/stock-labels';

export const dynamic = 'force-dynamic';
const KCOL: Record<string, string> = { service: 'var(--purple)', goods_nostock: 'var(--orange)', goods_stock: 'var(--blue)' };
type Sp = { kind?: string; q?: string; wh?: string };

export default async function Products({ searchParams }: { searchParams: Sp }) {
  const user = await requirePage('master.read');
  const showCost = can(user.role, 'cost.view');
  const kind = KIND_LABEL[searchParams.kind ?? ''] ? searchParams.kind! : '';
  const q = (searchParams.q ?? '').trim();
  const db = await getDb();
  const whs = await db.q<any>(`select id, name from warehouses order by is_main desc, code`);
  const wh = whs.some(w => w.id === searchParams.wh) ? searchParams.wh! : '';
  const rows = await db.q<any>(`select p.*, case when p.kind='goods_stock' then coalesce((select sum(qty_in-qty_out) from stock_movements m where m.product_id=p.id and m.voided_at is null and ($3='' or m.warehouse_id=$3::uuid)),0) end onhand,
      (select string_agg(u.unit || '|' || u.factor, ';') from product_units u where u.product_id=p.id) units
    from products p where ($1='' or p.kind=$1) and ($2='' or p.name ilike '%'||$2||'%' or p.code ilike '%'||$2||'%' or p.barcode ilike '%'||$2||'%') order by p.name`, [kind, q, wh]);
  const href = (o: Partial<Sp>) => { const u = new URLSearchParams(); Object.entries({ kind, q, wh, ...o }).forEach(([k, v]) => v && u.set(k, String(v))); return `/products?${u}`; };
  return (
    <>
      <div className="top"><div><h1>รายการสินค้าทั้งหมด</h1><p className="sub">{rows.length} รายการ</p></div>
        {can(user.role, 'master.write') && <Link className="btn" href="/products/new">+ สร้างใหม่</Link>}</div>
      <div className="tabs noprint">
        <Link href={href({ kind: '' })} className={kind === '' ? 'on' : ''}>แสดงทั้งหมด</Link>
        {Object.entries(KIND_LABEL).map(([k, l]) => <Link key={k} href={href({ kind: k })} className={kind === k ? 'on' : ''}>{l}</Link>)}</div>
      <form className="panel noprint" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }} action="/products">
        {kind && <input type="hidden" name="kind" value={kind} />}
        <select name="wh" defaultValue={wh} aria-label="คลัง"><option value="">คลังทั้งหมด</option>{whs.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
        <input name="q" defaultValue={q} placeholder="ค้นหาจาก ชื่อ, รหัสสินค้า หรือบาร์โค้ด" style={{ flex: 1, minWidth: 220 }} />
        <button className="btn sm">ค้นหา</button></form>
      <div className="panel" style={{ padding: 0, overflowX: 'auto' }}>
        {rows.length === 0 ? <div className="empty">ไม่พบสินค้า</div> :
          <table><thead><tr><th>รหัสสินค้า</th><th>ชื่อสินค้า</th><th>ชนิด</th><th className="num">ราคาต่อหน่วย</th>{showCost && <th className="num">ราคาซื้อ</th>}<th className="num">จำนวนคงคลัง</th><th>หมวดสินค้า</th></tr></thead>
            <tbody>{rows.map(r => (
              <tr key={r.id}><td className="no">{r.code}</td>
                <td><Link href={`/products/${r.id}`}>{r.name}</Link>{r.barcode && <div className="sub">{r.barcode}</div>}</td>
                <td><span className="pill" style={{ background: KCOL[r.kind], color: '#fff', minWidth: 130 }}>{KIND_LABEL[r.kind]}</span></td>
                <td className="num">{money(r.sale_price)}</td>{showCost && <td className="num">{money(r.purchase_price)}</td>}
                <td className="num">{r.onhand == null ? '-' : <span style={{ color: Number(r.onhand) < 0 ? 'var(--red)' : undefined }} title={(r.units ?? '').split(';').filter(Boolean).map((s: string) => { const [u, f] = s.split('|'); return `≈ ${qty(Number(r.onhand) / Number(f))} ${u}`; }).join(' · ')}>{qty(r.onhand)} {r.base_unit}</span>}</td>
                <td>{r.category ?? ''}</td></tr>))}</tbody></table>}
      </div>
    </>
  );
}
