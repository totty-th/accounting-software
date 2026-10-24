import { can } from '@/lib/permissions';
import { requirePage } from '@/lib/auth';
import { getDb, today } from '@/lib/db';
import { money, dateTh, partyName } from '@/lib/format';
import { Pill } from '@/components/Pill';
import { Group } from '@/components/Board';
import { ActionButton } from '@/components/ActionButton';
import { RiForm } from '@/components/RiForm';
import * as A from '@/lib/actions';

export default async function PurchaseOrders() {
  const user = await requirePage('expenses.read');
  const W = can(user.role, 'expenses.write'), AP = can(user.role, 'expenses.approve');
  const db = await getDb();
  const rows = await db.q(`select o.*, c.business_name, c.contact_name, r.ri_no,
      (select string_agg(p.code || ' ×' || trim(trailing '.' from trim(trailing '0' from l.qty::text)), ', ' order by l.line_no)
         from purchase_order_lines l join products p on p.id=l.product_id where l.po_id=o.id) items
    from purchase_orders o join contacts c on c.id=o.contact_id left join goods_receipts r on r.id=o.ri_id
    order by o.po_date desc, o.po_no desc`);
  const vendors = (await db.q(`select id, business_name, contact_name from contacts where not is_cash_default and is_vendor order by business_name nulls last`))
    .map(c => ({ id: c.id as string, label: partyName(c) }));
  const products = (await db.q(`select id, code, name, purchase_price from products where kind='goods_stock' order by code`))
    .map(p => ({ id: p.id as string, label: `${p.code} ${p.name}`, price: Number(p.purchase_price) }));
  const sets: [string, string, string][] = [['pending', 'รออนุมัติ', 'var(--orange)'], ['approved', 'อนุมัติแล้ว', 'var(--blue)'],
    ['converted', 'ดำเนินการแล้ว', 'var(--teal)'], ['rejected', 'ไม่อนุมัติ', 'var(--red)'], ['cancelled', 'ยกเลิก', 'var(--grey)']];
  return (
    <>
      <div className="top"><div><h1>ใบสั่งซื้อ</h1>
        <p className="sub">ไม่ลงบัญชีและไม่ขยับสต็อก · สร้างใบรับสินค้าจากใบสั่งซื้อเมื่อสินค้ามาถึง</p></div></div>
      {W && <RiForm vendors={vendors} products={products} today={today()} action={A.createPurchaseOrder} title="ใบสั่งซื้อใหม่" />}
      {rows.length === 0 && <div className="panel empty">ยังไม่มีใบสั่งซื้อ</div>}
      {sets.map(([s, title, color]) => {
        const rs = rows.filter(r => r.status === s); if (!rs.length) return null;
        return (
          <Group key={s} title={title} color={color} count={rs.length}>
            <table><thead><tr><th>เลขที่</th><th>ผู้ขาย</th><th>รายการ</th><th>วันที่</th><th>ใบรับสินค้า</th><th className="num">ยอดรวม</th><th>สถานะ</th><th /></tr></thead>
              <tbody>{rs.map(r => (
                <tr key={r.id}><td className="no">{r.po_no}</td><td>{partyName(r)}</td><td>{r.items}</td><td>{dateTh(r.po_date)}</td><td>{r.ri_no ?? '-'}</td>
                  <td className="num">{money(r.total)}</td><td><Pill s={r.status === 'pending' ? 'pending_approval' : r.status} /></td>
                  <td><div className="acts">
                    {AP && r.status === 'pending' && <ActionButton label="อนุมัติ" variant="ghost" action={A.approvePurchaseOrder.bind(null, r.id)} />}
                    {W && (r.status === 'pending' || r.status === 'approved') && <ActionButton label="สร้างใบรับสินค้า" action={A.upgradePoToRi.bind(null, r.id)} />}
                    {AP && (r.status === 'pending' || r.status === 'approved') && <ActionButton label="ไม่อนุมัติ" variant="ghost" action={A.rejectPurchaseOrder.bind(null, r.id)} />}
                    {W && (r.status === 'approved' || r.status === 'rejected') && <ActionButton label="รีเซ็ต" variant="ghost" action={A.resetPurchaseOrder.bind(null, r.id)} />}
                    {W && r.status !== 'cancelled' && r.status !== 'converted' && <ActionButton label="ยกเลิก" variant="danger" confirmText="c" action={A.cancelPurchaseOrder.bind(null, r.id)} />}
                  </div></td></tr>))}</tbody></table>
          </Group>);
      })}
    </>
  );
}
