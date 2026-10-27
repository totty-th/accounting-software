import Link from 'next/link';
import { requirePage } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { qty } from '@/lib/format';

export const dynamic = 'force-dynamic';
export default async function LowStock({ searchParams }: { searchParams: { wh?: string } }) {
  await requirePage('stock.read');
  const db = await getDb();
  const whs = await db.q<any>('select id, name, low_stock_min from warehouses order by is_main desc, code');
  const wh = whs.some(w => w.id === searchParams.wh) ? searchParams.wh! : null;
  const rows = await db.q<any>('select * from low_stock_items($1)', [wh]);
  const any = whs.some(w => w.low_stock_min != null);
  return (
    <>
      <div className="top"><div><h1>รายการสินค้าใกล้หมด</h1><p className="sub">แสดงสินค้านับสต็อกที่คงเหลือ ≤ จำนวนขั้นต่ำของคลังนั้น · ตั้งขั้นต่ำที่ <Link href="/stock/warehouses">คลังสินค้า</Link></p></div></div>
      <form className="noprint" style={{ margin: '0 0 10px' }} action="/stock/low"><select name="wh" defaultValue={wh ?? ''}><option value="">คลังทั้งหมด</option>{whs.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select> <button className="btn sm ghost">กรอง</button></form>
      <div className="panel" style={{ padding: 0, overflowX: 'auto' }}>
        {!any ? <div className="empty">ยังไม่ได้ตั้งจำนวนขั้นต่ำของคลังใด — ตั้งที่เมนูคลังสินค้า</div> : rows.length === 0 ? <div className="empty">ไม่มีสินค้าใกล้หมด</div> :
          <table><thead><tr><th>รหัสสินค้า</th><th>ชื่อสินค้า</th><th className="num">จำนวนขั้นต่ำ</th><th className="num">จำนวนคงคลัง</th><th>คลังสินค้า</th></tr></thead>
            <tbody>{rows.map((r: any) => <tr key={r.product_id + r.warehouse_id}><td className="no">{r.code}</td><td><Link href={`/products/${r.product_id}?tab=stock`}>{r.name}</Link></td>
              <td className="num">{qty(r.min_qty)}</td><td className="num" style={{ color: Number(r.on_hand) < 0 ? 'var(--red)' : undefined }}>{Number(r.on_hand) < 0 ? `(${qty(-r.on_hand)})` : qty(r.on_hand)} {r.unit}</td><td>{r.warehouse_name}</td></tr>)}</tbody></table>}
      </div>
    </>
  );
}
