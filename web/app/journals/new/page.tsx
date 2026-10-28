import { notFound } from 'next/navigation';
import { requirePage } from '@/lib/auth';
import { getDb, today } from '@/lib/db';
import { dateIso, partyName } from '@/lib/format';
import { JvForm, type JvInit } from '@/components/JvForm';

export const dynamic = 'force-dynamic';
export default async function NewJv({ searchParams }: { searchParams: { draft?: string } }) {
  await requirePage('journal.write');
  const db = await getDb();
  const accounts = await db.q<any>('select code, name from accounts where is_active order by code');
  const contacts = (await db.q<any>('select id, business_name, contact_name from contacts where not is_cash_default order by coalesce(business_name, contact_name)')).map(c => ({ id: c.id as string, name: partyName(c) }));
  let init: JvInit = { date: today(), contact_id: '', ref_no: '', memo: '', note: '', lines: [] };
  if (searchParams.draft) {
    if (!/^[0-9a-f-]{36}$/i.test(searchParams.draft)) notFound();
    const [d] = await db.q<any>('select * from jv_drafts where id = $1', [searchParams.draft]);
    if (!d) notFound();
    init = { date: d.doc_date ? dateIso(d.doc_date) : today(), contact_id: d.contact_id ?? '', ref_no: d.ref_no ?? '', memo: d.memo ?? '', note: d.note ?? '',
      lines: (d.lines as any[]).map(l => { const a = accounts.find(x => x.code === l.account); return { account: a ? `${a.code} ${a.name}` : l.account ?? '', debit: l.debit ? String(l.debit) : '', credit: l.credit ? String(l.credit) : '', desc: l.desc ?? '' }; }) };
  }
  return (
    <>
      <div className="top"><div><h1>สร้างรายการ สมุดรายวันทั่วไป</h1><p className="sub">{searchParams.draft ? 'แก้ไขฉบับร่าง' : 'ใบสำคัญที่อนุมัติแล้วแก้ไขไม่ได้ ยกเลิกด้วยใบกลับรายการ'}</p></div></div>
      <JvForm accounts={accounts} contacts={contacts} init={init} draftId={searchParams.draft} />
    </>
  );
}
