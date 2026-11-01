import Link from 'next/link';
import { ClickRow } from '@/components/ClickRow';
import { requirePage } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { getDb } from '@/lib/db';
import { Group } from '@/components/Board';

export const dynamic = 'force-dynamic';
type SP = { q?: string; type?: string; kind?: string; branch?: string };
// ตัวกรองแบบชิปสี (ลูกค้า/ผู้จำหน่าย/ทั้งสอง · นิติบุคคล/บุคคลธรรมดา · สำนักงานใหญ่/สาขา) กดซ้ำเพื่อยกเลิก
const TYPE: [string, string, string][] = [['customer', 'ลูกค้า', '#0086c0'], ['vendor', 'ผู้จำหน่าย', '#fdab3d'], ['both', 'ลูกค้า/ผู้จำหน่าย', '#00c875']];
const KIND: [string, string, string][] = [['juristic', 'นิติบุคคล', '#a25ddc'], ['individual', 'บุคคลธรรมดา', '#037f4c']];
const BRANCH: [string, string, string][] = [['hq', 'สำนักงานใหญ่', '#579bfc'], ['branch', 'สาขา', '#ff642e']];
const typeOf = (r: any) => (r.is_customer && r.is_vendor ? 'both' : r.is_vendor ? 'vendor' : 'customer');

export default async function Contacts({ searchParams }: { searchParams: SP }) {
  const user = await requirePage('master.read');
  const sp = { q: (searchParams.q ?? '').trim(), type: searchParams.type ?? '', kind: searchParams.kind ?? '', branch: searchParams.branch ?? '' };
  const all = await (await getDb()).q<any>(`select * from contacts
    where ($1 = '' or concat_ws(' ', business_name, contact_name, tax_id, contact_code, person_email, person_mobile) ilike '%' || $1 || '%')
    order by is_cash_default, business_name nulls last, contact_name`, [sp.q]);
  const kindOf = (r: any) => (r.person_kind === 'individual' ? 'individual' : 'juristic');
  const brOf = (r: any) => (r.branch_code ? 'branch' : 'hq');
  const rows = all.filter(r => (!sp.type || typeOf(r) === sp.type) && (!sp.kind || kindOf(r) === sp.kind) && (!sp.branch || brOf(r) === sp.branch));
  const href = (k: keyof SP, v: string) => { const p = new URLSearchParams(); const n = { ...sp, [k]: sp[k] === v ? '' : v }; Object.entries(n).forEach(([a, b]) => b && p.set(a, b)); return `/contacts${p.size ? `?${p}` : ''}`; };
  const chip = (k: keyof SP, [v, label, c]: [string, string, string], fn: (r: any) => string) => {
    const on = sp[k] === v, n = all.filter(r => fn(r) === v).length;
    return <Link key={v} href={href(k, v)} className={`cchip${on ? ' on' : ''}`} style={{ ['--c' as any]: c }}><i />{label}<b>{n}</b></Link>;
  };
  const pill = (t: string, c: string) => <span className="cpill" style={{ ['--c' as any]: c }}>{t}</span>;
  return (
    <>
      <div className="top"><div><h1>สมุดรายชื่อ</h1><p className="sub">ลูกค้าและผู้จำหน่าย ใช้ร่วมกันทั้งฝั่งขายและฝั่งซื้อ</p></div>
        {can(user.role, 'master.write') && <Link className="btn ghost" href="/contacts/import">นำเข้ารายชื่อ</Link>} {can(user.role, 'contact.create') && <Link className="btn" href="/contacts/new">+ สร้างใหม่</Link>}</div>
      <form className="filters" style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <input name="q" defaultValue={sp.q} placeholder="ค้นหาชื่อ ผู้ติดต่อ เลขผู้เสียภาษี รหัส อีเมล" style={{ minWidth: 280 }} />
        {(['type', 'kind', 'branch'] as const).map(k => sp[k] && <input key={k} type="hidden" name={k} value={sp[k]} />)}
        <button className="btn ghost">ค้นหา</button>
        {(sp.type || sp.kind || sp.branch || sp.q) && <Link className="btn ghost" href="/contacts">ล้างตัวกรอง</Link>}
      </form>
      <div className="cfilters">
        <div><small>ประเภท</small>{TYPE.map(t => chip('type', t, typeOf))}</div>
        <div><small>ประเภทผู้ติดต่อ</small>{KIND.map(t => chip('kind', t, kindOf))}</div>
        <div><small>สถานประกอบการ</small>{BRANCH.map(t => chip('branch', t, brOf))}</div>
      </div>
      <Group title="รายชื่อทั้งหมด" color="var(--grey)" count={rows.length}>
        <table><thead><tr><th>รหัส</th><th>ชื่อ</th><th>ผู้ติดต่อ</th><th>เบอร์/อีเมล</th><th>เลขผู้เสียภาษี</th><th>เครดิต</th><th>ประเภท</th></tr></thead>
          <tbody>{rows.map(r => { const t = TYPE.find(x => x[0] === typeOf(r))!; return (
            <ClickRow key={r.id} href={`/contacts/${r.id}`}><td>{r.contact_code ?? '-'}</td>
              <td className="no"><span className="cdot" style={{ background: t[2] }} /><Link href={`/contacts/${r.id}`}>{r.business_name ?? r.contact_name}</Link>
                <div className="cpills">{pill(r.branch_code ? `สาขา ${r.branch_code}${r.branch_name ? ` ${r.branch_name}` : ''}` : 'สำนักงานใหญ่', r.branch_code ? '#ff642e' : '#579bfc')}
                  {pill(kindOf(r) === 'individual' ? 'บุคคลธรรมดา' : 'นิติบุคคล', kindOf(r) === 'individual' ? '#037f4c' : '#a25ddc')}{r.is_foreign && pill('ต่างประเทศ', '#797e93')}</div></td>
              <td>{r.business_name ? r.contact_name ?? '-' : '-'}</td>
              <td>{[r.person_mobile, r.person_email].filter(Boolean).join(' / ') || '-'}</td>
              <td>{r.tax_id ?? '-'}</td><td>{r.credit_days ? `${r.credit_days} วัน` : '-'}</td>
              <td>{pill(t[1], t[2])}</td></ClickRow>); })}</tbody></table>
        {rows.length === 0 && <div className="empty">ไม่พบรายชื่อที่ตรงตัวกรอง</div>}
      </Group>
    </>
  );
}
