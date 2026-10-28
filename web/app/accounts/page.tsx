import Link from 'next/link';
import { requirePage } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { getDb, today } from '@/lib/db';
import { money } from '@/lib/format';
import { fiscalYears, yearOf } from '@/lib/fiscal';
import { AccountManager } from '@/components/AccountManager';
import { ReportTools } from '@/components/ReportTools';

export const dynamic = 'force-dynamic';
const TYPES: [string, string][] = [['', 'ทั้งหมด'], ['asset', 'สินทรัพย์'], ['liability', 'หนี้สิน'], ['equity', 'ส่วนของผู้ถือหุ้น'], ['revenue', 'รายได้'], ['expense', 'ค่าใช้จ่าย']];
const SIZES = [20, 50, 100];

export default async function Accounts({ searchParams }: { searchParams: { q?: string; type?: string; year?: string; size?: string; page?: string; all?: string } }) {
  const user = await requirePage('reports.read');
  const db = await getDb();
  const years = await fiscalYears(db, today());
  const year = yearOf(searchParams.year, years);
  const q = (searchParams.q ?? '').trim(), type = TYPES.some(t => t[0] === searchParams.type) ? searchParams.type! : '';
  const size = SIZES.includes(Number(searchParams.size)) ? Number(searchParams.size) : 20, page = Math.max(1, Number(searchParams.page) || 1);
  const all = searchParams.all === '1';
  const rows = await db.q<any>(
    `select a.id, a.code, a.name, a.type, a.description, a.is_active, coalesce(t.closing, 0) as bal
       from accounts a left join trial_balance($1::date, $2::date, true) t on t.code = a.code
      where ($3 = '' or a.type = $3) and ($4 = '' or a.code ilike '%'||$4||'%' or a.name ilike '%'||$4||'%') and ($5 or a.is_active)
      order by a.code`, [`${year}-01-01`, `${year}-12-31`, type, q, all]);
  const pages = Math.max(1, Math.ceil(rows.length / size)), pg = Math.min(page, pages), view = rows.slice((pg - 1) * size, pg * size);
  const qs = (o: Record<string, string | number>) => '/accounts?' + new URLSearchParams(Object.entries({ q, type, year, size, all: all ? '1' : '', ...o }).filter(([, v]) => v !== '' && v != null).map(([k, v]) => [k, String(v)])).toString();
  const canW = can(user.role, 'accounts.write');
  return (
    <>
      <div className="top"><div><h1>ผังบัญชี / บัญชีแยกประเภท</h1><p className="sub">กดที่บัญชีเพื่อดูบัญชีแยกประเภท · ยอดคงเหลือ ณ สิ้นปี {year} (เดบิต + / เครดิต −)</p></div>{canW && <AccountManager />}</div>
      <form className="row-inline" method="get">
        <label className="f">ค้นหา<input name="q" defaultValue={q} placeholder="รหัสหรือชื่อบัญชี" /></label>
        <label className="f">ประเภท<select name="type" defaultValue={type}>{TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className="f">ปี<select name="year" defaultValue={year}>{years.map(y => <option key={y}>{y}</option>)}</select></label>
        <label className="f">ต่อหน้า<select name="size" defaultValue={size}>{SIZES.map(s => <option key={s}>{s}</option>)}</select></label>
        <label className="f" style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 6, flexDirection: 'row' }}><input type="checkbox" name="all" value="1" defaultChecked={all} style={{ width: 'auto' }} /> รวมบัญชีที่ปิดใช้งาน</label>
        <button className="btn">ค้นหา</button>
      </form>
      <ReportTools title="ผังบัญชี" meta={[['ปี', String(year)]]} />
      <div className="panel" style={{ padding: 0, overflowX: 'auto' }} data-report>
        <table><thead><tr><th>รหัส</th><th>ชื่อบัญชี</th><th>ประเภท</th><th className="num">ยอดคงเหลือ {year}</th><th className="noprint" /></tr></thead>
          <tbody>{view.map(a => (
            <tr key={a.id} style={a.is_active ? undefined : { opacity: 0.55 }}>
              <td className="no"><Link href={`/accounts/${a.code}?year=${year}`}>{a.code}</Link></td>
              <td><Link href={`/accounts/${a.code}?year=${year}`}>{a.name}</Link>{!a.is_active && ' (ปิดใช้งาน)'}{a.description && <div className="sub">{a.description}</div>}</td>
              <td>{TYPES.find(t => t[0] === a.type)?.[1]}</td><td className="num">{money(a.bal)}</td>
              <td className="noprint">{canW && <AccountManager edit={a} />}</td></tr>))}
            {view.length === 0 && <tr><td colSpan={5} className="empty">ไม่พบบัญชี</td></tr>}</tbody></table>
      </div>
      <div className="noprint" style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 10 }}>
        <span className="sub">ทั้งหมด {rows.length} บัญชี · หน้า {pg}/{pages}</span>
        {pg > 1 && <Link className="btn sm ghost" href={qs({ page: pg - 1 })}>ก่อนหน้า</Link>}
        {pg < pages && <Link className="btn sm ghost" href={qs({ page: pg + 1 })}>ถัดไป</Link>}
      </div>
    </>
  );
}
