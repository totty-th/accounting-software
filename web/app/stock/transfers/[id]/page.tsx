import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePage } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { getDb } from '@/lib/db';
import { dateTh, money, qty } from '@/lib/format';
import { Pill } from '@/components/Pill';
import { PrintButton } from '@/components/ShareTools';
import { ActionButton } from '@/components/ActionButton';
import { receiveTransfer, resetTransfer, cancelTransfer } from '@/lib/actions';

export const dynamic = 'force-dynamic';
export default async function TransferPage({ params }: { params: { id: string } }) {
  const user = await requirePage('stock.read');
  const db = await getDb();
  const [t] = await db.q<any>(`select t.*, f.name from_name, w.name to_name from stock_transfers t join warehouses f on f.id=t.from_wh join warehouses w on w.id=t.to_wh where t.id::text=$1 or t.tf_no=$1`, [params.id]);
  if (!t) notFound();
  const ls = await db.q<any>(`select l.*, p.code, p.name, p.base_unit from stock_transfer_lines l join products p on p.id=l.product_id where l.tf_id=$1 order by l.line_no`, [t.id]);
  const w = can(user.role, 'master.write');
  const total = ls.reduce((s: number, l: any) => s + Number(l.qty) * Number(l.unit_cost), 0);
  return (
    <>
      <div className="top"><div><p className="sub noprint"><Link href="/stock/transfers">← โอนสินค้า</Link></p><h1>ใบโอนสินค้า {t.tf_no} <Pill s={t.status} /></h1>
        <p className="sub">วันที่ {dateTh(t.tf_date)} · {t.from_name} → {t.to_name}</p></div>
        <div className="noprint" style={{ display: 'flex', gap: 8 }}><PrintButton /></div>
        {w && <div className="noprint" style={{ display: 'flex', gap: 8 }}>
          {t.status === 'pending' && <><ActionButton label="รับสินค้าแล้ว" action={receiveTransfer.bind(null, t.id)} /><ActionButton variant="ghost" label="ยกเลิก" confirmText="ยกเลิกใบโอนนี้" action={cancelTransfer.bind(null, t.id)} /></>}
          {t.status === 'received' && <ActionButton variant="ghost" label="รีเซ็ต" confirmText="ย้อนสต็อกที่โอนกลับ และกลับเป็นรอดำเนินการ" action={resetTransfer.bind(null, t.id)} />}</div>}</div>
      <div className="panel" style={{ padding: 0, overflowX: 'auto' }}>
        <table><thead><tr><th>ลำดับ</th><th>ชื่อสินค้า / รายละเอียด</th><th className="num">จำนวน</th><th>หน่วย</th><th className="num">ราคาต้นทุนต่อหน่วย</th><th className="num">ราคารวม</th></tr></thead>
          <tbody>{ls.map((l: any) => <tr key={l.line_no}><td>{l.line_no}</td><td><Link href={`/products/${l.product_id}?tab=stock`}>{l.code} {l.name}</Link></td><td className="num">{qty(l.qty)}</td><td>{l.base_unit}</td>
            <td className="num">{money(l.unit_cost)}</td><td className="num">{money(Number(l.qty) * Number(l.unit_cost))}</td></tr>)}</tbody>
          <tfoot><tr><td colSpan={5} className="num"><b>รวม</b></td><td className="num"><b>{money(total)}</b></td></tr></tfoot></table>
      </div>
      <div className="print-only" style={{ display: 'flex', justifyContent: 'space-between', marginTop: 48 }}><span>ผู้ส่งสินค้า ______________________</span><span>ผู้รับสินค้า ______________________</span></div>
    </>
  );
}
