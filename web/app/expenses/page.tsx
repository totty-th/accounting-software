import { can } from '@/lib/permissions';
import { requirePage } from '@/lib/auth';
import Link from 'next/link';
import { getDb } from '@/lib/db';
import { money, dateTh, partyName } from '@/lib/format';
import { CardForm, PettyForm } from '@/components/CardForm';

import { related } from '@/lib/related';
import { DocList, type DocRow } from '@/components/DocList';
import { STATUS } from '@/lib/status';

export default async function Expenses() {
  const user = await requirePage('expenses.read');
  const W = can(user.role, 'expenses.write'), MW = can(user.role, 'master.write');
  const db = await getDb();
  const rows = await db.q(`select e.*, c.business_name, c.contact_name,
      (select string_agg(description, ', ' order by line_no) from expense_lines l where l.expense_id=e.id) items,
      exists (select 1 from purchase_tax_invoices t where t.doc_type='EXP' and t.doc_id=e.id) has_tax
    from expenses e join contacts c on c.id=e.contact_id order by e.exp_date desc, e.exp_no desc`);
  const relMap = await related(db, 'exp', rows.map((r: any) => r.id));
  const list: DocRow[] = rows.map(r => ({ id: r.id, href: `/expenses/${r.id}`, date: dateTh(r.exp_date), no: r.exp_no, party: partyName(r), detail: r.items ?? '',
    due: r.due_date ? dateTh(r.due_date) : '-', total: Number(r.total), status: r.status, label: STATUS[r.status]?.[0] ?? r.status, tone: STATUS[r.status]?.[1] ?? 'grey',
    rel: relMap.get(r.id),
    flag: Number(r.wht_total) ? `· หัก ณ ที่จ่าย ${money(r.wht_total)}` : undefined }));
  return (
    <>
      <div className="top"><div><h1>ค่าใช้จ่าย</h1><p className="sub">บันทึกแล้วตั้งเจ้าหนี้ทันที จ่ายเงินแล้วออกหนังสือรับรองหัก ณ ที่จ่ายให้อัตโนมัติ · คลิกแถวเพื่อเปิดเอกสาร</p></div>
        {W && <Link className="btn" href="/expenses/new">+ ค่าใช้จ่ายใหม่</Link>}</div>
      {MW && <><CardForm /><PettyForm /></>}
      <DocList rows={list} showDue empty="ยังไม่มีค่าใช้จ่าย" />
    </>
  );
}
