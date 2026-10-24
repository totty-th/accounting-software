import { can } from '@/lib/permissions';
import { requirePage } from '@/lib/auth';
import { getDb, today } from '@/lib/db';
import { money, dateTh, partyName } from '@/lib/format';
import { CardForm, PettyForm } from '@/components/CardForm';
import Link from 'next/link';
import * as A from '@/lib/actions';

import { DocList, type DocRow } from '@/components/DocList';
import { STATUS } from '@/lib/status';

export default async function Purchases() {
  const user = await requirePage('expenses.read');
  const W = can(user.role, 'expenses.write'), MW = can(user.role, 'master.write');
  const db = await getDb();
  const rows = await db.q(`select g.*, c.business_name, c.contact_name,
      (select string_agg(p.code || ' ×' || trim(trailing '.' from trim(trailing '0' from l.qty::text)), ', ' order by l.line_no)
         from goods_receipt_lines l join products p on p.id=l.product_id where l.ri_id=g.id) items
    from goods_receipts g join contacts c on c.id=g.contact_id order by g.ri_date desc, g.ri_no desc`);
  const vendors = (await db.q(`select id, business_name, contact_name from contacts where not is_cash_default and is_vendor order by business_name nulls last`))
    .map(c => ({ id: c.id as string, label: partyName(c) }));
  const products = (await db.q(`select id, code, name, purchase_price from products where kind='goods_stock' order by code`))
    .map(p => ({ id: p.id as string, label: `${p.code} ${p.name}`, price: Number(p.purchase_price) }));
  const list: DocRow[] = rows.map(r => ({ id: r.id, href: `/purchases/ri/${r.id}`, date: dateTh(r.ri_date), no: r.ri_no, party: partyName(r), detail: r.items ?? '',
    due: r.due_date ? dateTh(r.due_date) : '-', total: Number(r.total), status: r.status, label: STATUS[r.status]?.[0] ?? r.status, tone: STATUS[r.status]?.[1] ?? 'grey',
    flag: r.ref_no ? `· อ้างอิง ${r.ref_no}` : undefined }));
  return (
    <>
      <div className="top"><div><h1>ใบรับสินค้า</h1>
        <p className="sub">บันทึกแล้วสินค้าเข้าสต็อกและตั้งเจ้าหนี้ทันที · ไม่อนุมัติ = กลับรายการและถอนสต็อก · คลิกแถวเพื่อเปิดเอกสาร</p></div></div>
      {W && <p><Link className="btn" href="/purchases/new">+ สร้างใบรับสินค้า</Link></p>}
      {MW && <><CardForm /><PettyForm /></>}
      <DocList rows={list} showDue empty="ยังไม่มีใบรับสินค้า" />
    </>
  );
}
