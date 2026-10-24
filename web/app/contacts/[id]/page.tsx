import { notFound } from 'next/navigation';
import { requirePage } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { getDb } from '@/lib/db';
import { ContactForm } from '@/components/ContactForm';

export const dynamic = 'force-dynamic';
export default async function EditContact({ params }: { params: { id: string } }) {
  const user = await requirePage('master.read');
  if (!/^[0-9a-f-]{36}$/.test(params.id)) notFound();
  const r = (await (await getDb()).q<any>('select * from contacts where id=$1', [params.id]))[0];
  if (!r) notFound();
  const init: Record<string, any> = {};
  for (const [k, x] of Object.entries(r)) init[k] = x ?? '';
  init.branch = r.branch_code ? 'branch' : 'head';
  init.person_kind = r.person_kind ?? 'juristic';
  return (<><div className="top"><div><h1>แก้ไขรายชื่อผู้ติดต่อ</h1><p className="sub">{r.business_name ?? r.contact_name}</p></div></div>
    <ContactForm id={r.id} init={init} canSave={!r.is_cash_default && (can(user.role, 'master.write') || can(user.role, 'contact.create'))} /></>);
}
