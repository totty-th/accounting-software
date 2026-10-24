import { requirePage } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { money, qty, dateTh } from '@/lib/format';
import { Group } from '@/components/Board';

export default async function Stock() {
  await requirePage('stock.read');
  const db = await getDb();
  const prods = await db.q(`select p.id, p.code, p.name, p.base_unit, p.block_negative,
      coalesce(s.qty,0) q, coalesce(s.value,0) v, case when coalesce(s.qty,0) > 0 then round(s.value/s.qty,2) else coalesce(s.last_avg,p.purchase_price) end avg
    from products p left join product_stock s on s.product_id=p.id where p.kind='goods_stock' order by p.code`);
  const whs = await db.q(`select id, code, name from warehouses order by is_main desc, code`);
  const bal = await db.q(`select product_id, warehouse_id, sum(qty_in-qty_out) q from stock_movements where voided_at is null group by 1,2`);
  const alerts = await db.q(`select a.*, p.code, p.name, d.doc_no, d.doc_date from stock_alerts a join products p on p.id=a.product_id left join sales_docs d on d.id=a.doc_id order by a.created_at desc limit 20`);
  return (
    <>
      <div className="top"><div><h1>สต็อกสินค้า</h1><p className="sub">ต้นทุนเฉลี่ยเคลื่อนที่ · ตัดสต็อกเมื่อบันทึกใบแจ้งหนี้</p></div></div>
      {alerts.length > 0 && (
        <Group title="ขายเกินคงเหลือ" color="var(--red)" count={alerts.length}>
          <table><thead><tr><th>เอกสาร</th><th>สินค้า</th><th className="num">ขาดอยู่</th><th>วันที่</th></tr></thead>
            <tbody>{alerts.map(a => <tr key={a.id}><td className="no">{a.doc_no}</td><td>{a.code} {a.name}</td><td className="num">{qty(a.shortfall)}</td><td>{dateTh(a.doc_date)}</td></tr>)}</tbody></table>
        </Group>)}
      <Group title="คงเหลือตามคลัง" color="var(--blue)" count={prods.length}>
        {prods.length === 0 ? <div className="empty">ยังไม่มีสินค้านับสต็อก เพิ่มที่เมนู “สินค้า”</div> : (
          <table><thead><tr><th>สินค้า</th>{whs.map(w => <th key={w.id} className="num">{w.name}</th>)}<th className="num">รวม</th><th className="num">ต้นทุนเฉลี่ย</th><th className="num">มูลค่า</th></tr></thead>
            <tbody>{prods.map(p => (
              <tr key={p.id}><td className="no">{p.code} <span style={{ fontWeight: 400 }}>{p.name}</span></td>
                {whs.map(w => <td key={w.id} className="num">{qty(bal.find(b => b.product_id === p.id && b.warehouse_id === w.id)?.q ?? 0)}</td>)}
                <td className="num"><b style={{ color: Number(p.q) < 0 ? 'var(--red)' : undefined }}>{qty(p.q)}</b> {p.base_unit}</td>
                <td className="num">{money(p.avg)}</td><td className="num">{money(p.v)}</td></tr>))}</tbody></table>)}
      </Group>
    </>
  );
}
