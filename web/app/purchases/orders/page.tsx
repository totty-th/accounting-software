import Link from 'next/link';
import { can } from '@/lib/permissions';
import { requirePage } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { dateTh, partyName } from '@/lib/format';
import { STATUS } from '@/lib/status';
import { related } from '@/lib/related';
import { DocList, type DocRow } from '@/components/DocList';

export default async function PurchaseOrders() {
  const user = await requirePage('expenses.read');
  const W = can(user.role, 'expenses.write');
  const db = await getDb();
  const rows = await db.q(`select o.*, c.business_name, c.contact_name, r.ri_no,
      (select string_agg(p.code || ' ×' || trim(trailing '.' from trim(trailing '0' from l.qty::text)), ', ' order by l.line_no)
         from purchase_order_lines l join products p on p.id=l.product_id where l.po_id=o.id) items
    from purchase_orders o join contacts c on c.id=o.contact_id left join goods_receipts r on r.id=o.ri_id
    order by o.po_date desc, o.po_no desc`);
  const relMap = await related(db, 'po', rows.map((r: any) => r.id));
  const list: DocRow[] = rows.map(r => { const k = r.status === 'pending' ? 'pending_approval' : r.status;
    return { id: r.id, href: `/purchases/orders/${r.id}`, date: dateTh(r.po_date), no: r.po_no, party: partyName(r), detail: r.items ?? '',
      due: r.due_date ? dateTh(r.due_date) : '-', total: Number(r.total), status: r.status, label: STATUS[k]?.[0] ?? r.status, tone: STATUS[k]?.[1] ?? 'grey',
      rel: relMap.get(r.id),
      flag: r.ri_no ? `→ ${r.ri_no}` : undefined }; });
  return (
    <>
      <div className="top"><div><h1>ใบสั่งซื้อ</h1>
        <p className="sub">ไม่ลงบัญชีและไม่ขยับสต็อก · สร้างใบรับสินค้าจากใบสั่งซื้อเมื่อสินค้ามาถึง · คลิกแถวเพื่อเปิดเอกสาร</p></div>
        {W && <Link className="btn" href="/purchases/orders/new">+ สร้างใบสั่งซื้อใหม่</Link>}</div>
      <DocList rows={list} showDue empty="ยังไม่มีใบสั่งซื้อ" />
    </>
  );
}
