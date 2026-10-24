import Link from 'next/link';
import { ClickRow } from '@/components/ClickRow';
import { requirePage } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { getDb } from '@/lib/db';
import { Group } from '@/components/Board';

export const dynamic = 'force-dynamic';
const TYPES: [string, string][] = [['', 'ทั้งหมด'], ['customer', 'ลูกค้า'], ['vendor', 'ผู้จำหน่าย']];
export default async function Contacts({ searchParams }: { searchParams: { q?: string; type?: string } }) {
  const user = await requirePage('master.read');
  const q = (searchParams.q ?? '').trim(), type = searchParams.type ?? '';
  const rows = await (await getDb()).q<any>(`select * from contacts
    where ($1 = '' or concat_ws(' ', business_name, contact_name, tax_id, contact_code, person_email, person_mobile) ilike '%' || $1 || '%')
      and ($2 = '' or ($2 = 'customer' and is_customer) or ($2 = 'vendor' and is_vendor))
    order by is_cash_default, business_name nulls last, contact_name`, [q, type]);
  return (
    <>
      <div className="top"><div><h1>สมุดรายชื่อ</h1><p className="sub">ลูกค้าและผู้จำหน่าย ใช้ร่วมกันทั้งฝั่งขายและฝั่งซื้อ</p></div>
        {can(user.role, 'contact.create') && <Link className="btn" href="/contacts/new">+ สร้างใหม่</Link>}</div>
      <form className="filters" style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <input name="q" defaultValue={q} placeholder="ค้นหาชื่อ ผู้ติดต่อ เลขผู้เสียภาษี รหัส อีเมล" style={{ minWidth: 280 }} />
        <select name="type" defaultValue={type}>{TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <button className="btn ghost">ค้นหา</button>
      </form>
      <Group title="รายชื่อทั้งหมด" color="var(--grey)" count={rows.length}>
        <table><thead><tr><th>รหัส</th><th>ชื่อ</th><th>ผู้ติดต่อ</th><th>เบอร์/อีเมล</th><th>เลขผู้เสียภาษี</th><th>เครดิต</th><th>ประเภท</th></tr></thead>
          <tbody>{rows.map(r => (
            <ClickRow key={r.id} href={`/contacts/${r.id}`}><td>{r.contact_code ?? '-'}</td>
              <td className="no"><Link href={`/contacts/${r.id}`}>{r.business_name ?? r.contact_name}</Link>
                <div className="sub">{r.person_kind === 'individual' ? 'บุคคลธรรมดา' : 'นิติบุคคล'}{r.is_foreign ? ' · ต่างประเทศ' : ''}{r.branch_code ? ` · สาขา ${r.branch_code}` : ''}</div></td>
              <td>{r.business_name ? r.contact_name ?? '-' : '-'}</td>
              <td>{[r.person_mobile, r.person_email].filter(Boolean).join(' / ') || '-'}</td>
              <td>{r.tax_id ?? '-'}</td><td>{r.credit_days ? `${r.credit_days} วัน` : '-'}</td>
              <td>{[r.is_customer && 'ลูกค้า', r.is_vendor && 'ผู้จำหน่าย'].filter(Boolean).join(', ') || '-'}</td></ClickRow>))}</tbody></table>
      </Group>
    </>
  );
}
