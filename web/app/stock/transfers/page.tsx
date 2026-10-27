import Link from 'next/link';
import { requirePage } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { getDb } from '@/lib/db';
import { dateTh } from '@/lib/format';
import { Pill } from '@/components/Pill';

export const dynamic = 'force-dynamic';
export default async function Transfers() {
  const user = await requirePage('stock.read');
  const rows = await (await getDb()).q<any>(`select t.id, t.tf_no, t.tf_date, t.status, f.name from_name, w.name to_name,
      (select sum(qty) from stock_transfer_lines where tf_id=t.id) q from stock_transfers t join warehouses f on f.id=t.from_wh join warehouses w on w.id=t.to_wh order by t.tf_date desc, t.tf_no desc`);
  return (
    <>
      <div className="top"><div><h1>โอนสินค้า</h1><p className="sub">โอนระหว่างคลัง ไม่ลงบัญชี · รับสินค้าแล้วสต็อกจึงขยับ</p></div>
        {can(user.role, 'master.write') && <Link className="btn" href="/stock/transfers/new">+ สร้างใหม่</Link>}</div>
      <div className="panel" style={{ padding: 0, overflowX: 'auto' }}>
        {rows.length === 0 ? <div className="empty">ยังไม่มีใบโอนสินค้า</div> :
          <table><thead><tr><th>วันที่</th><th>เลขที่เอกสาร</th><th>คลังต้นทาง</th><th>คลังปลายทาง</th><th className="num">จำนวนรวม</th><th>สถานะ</th></tr></thead>
            <tbody>{rows.map(r => <tr key={r.id} style={r.status === 'cancelled' ? { opacity: .55 } : undefined}><td>{dateTh(r.tf_date)}</td><td className="no"><Link href={`/stock/transfers/${r.id}`}>{r.tf_no}</Link></td>
              <td>{r.from_name}</td><td>{r.to_name}</td><td className="num">{Number(r.q).toLocaleString('th-TH')}</td><td><Pill s={r.status} /></td></tr>)}</tbody></table>}
      </div>
    </>
  );
}
