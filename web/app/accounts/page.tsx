import Link from 'next/link';
import { requirePage } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { getDb, today } from '@/lib/db';
import { ChartManager } from '@/components/ChartManager';
import { GlBar } from '@/components/GlBar';
import { GlSelectAll } from '@/components/GlSelectAll';
import { faMoney, glList, glRange, parseTypes, rangeParams, typeTh } from '@/lib/gl';

export const dynamic = 'force-dynamic';
const SIZES = [20, 50, 100];
type SP = { q?: string; type?: string; m?: string; month?: string; year?: string; from?: string; to?: string; size?: string; page?: string; all?: string; sort?: string };

export default async function Accounts({ searchParams }: { searchParams: SP }) {
  const user = await requirePage('reports.read');
  const db = await getDb();
  const r = glRange(searchParams, today());
  const q = (searchParams.q ?? '').trim(), types = parseTypes(searchParams.type);
  const size = SIZES.includes(Number(searchParams.size)) ? Number(searchParams.size) : 20, page = Math.max(1, Number(searchParams.page) || 1);
  const all = searchParams.all === '1', desc = searchParams.sort === 'desc';
  const rows = await glList(db, { q, types, from: r.from, to: r.to, all, desc });
  const pages = Math.max(1, Math.ceil(rows.length / size)), pg = Math.min(page, pages), view = rows.slice((pg - 1) * size, pg * size);
  const base = { q, type: types.join(','), ...rangeParams(r), size: String(size), all: all ? '1' : '', sort: desc ? 'desc' : '' };
  const qs = (o: Record<string, string | number>) => '/accounts?' + new URLSearchParams(Object.entries({ ...base, ...o }).filter(([, v]) => v !== '' && v != null).map(([k, v]) => [k, String(v)])).toString();
  const lq = new URLSearchParams(Object.entries(rangeParams(r))).toString();
  const canW = can(user.role, 'accounts.write');
  const nodes = canW ? await db.q<any>(
    `select a.id, a.code, a.name, a.name_en, a.description, a.description_en, a.parent_id, a.is_control, a.is_active,
            not (a.is_seed or exists (select 1 from journal_lines l where l.account_id = a.id) or exists (select 1 from accounts c where c.parent_id = a.id)
              or exists (select 1 from system_accounts s where s.account_code = a.code) or exists (select 1 from expense_lines e where e.account_code = a.code)
              or exists (select 1 from bank_accounts b where b.account_id = a.id) or exists (select 1 from petty_funds b where b.account_id = a.id)
              or exists (select 1 from credit_cards b where b.account_id = a.id) or exists (select 1 from cheque_accounts b where b.account_id = a.id)) deletable
       from accounts a order by a.code`) : [];
  return (
    <>
      <div className="top"><div><h1>บัญชีแยกประเภท</h1><p className="sub">กดที่บัญชีเพื่อดูรายการเคลื่อนไหว · ยอดคงเหลือ = เดบิต − เครดิต (เครดิตสุทธิเป็นวงเล็บ) · งบแสดงฐานะ = ยอดสะสมถึงสิ้นช่วง · รายได้/ค่าใช้จ่าย = ยอดในช่วง</p></div>{canW && <ChartManager nodes={nodes} />}</div>
      <GlBar mode="list" label={r.label} from={r.from} to={r.to} types={types} total={rows.length} />
      <div className="panel" style={{ padding: 0, overflowX: 'auto' }}>
        <table><thead><tr><th style={{ width: 28 }}><GlSelectAll /></th><th><Link href={qs({ sort: desc ? '' : 'desc', page: 1 })}>รหัสบัญชี {desc ? '↓' : '↑'}</Link></th><th>ชื่อ / รายละเอียด</th><th>กลุ่มบัญชี / ประเภท</th><th>หมวดบัญชี</th><th className="num">ยอดคงเหลือ</th></tr></thead>
          <tbody>{view.map(a => (
            <tr key={a.id} style={a.is_active ? undefined : { opacity: 0.55 }}>
              <td><input type="checkbox" data-sel value={a.code} style={{ width: 'auto' }} aria-label={`เลือก ${a.code}`} /></td>
              <td className="no"><Link href={`/accounts/${a.code}?${lq}`}>{a.code}</Link></td>
              <td><Link href={`/accounts/${a.code}?${lq}`}>{a.name}</Link>{!a.is_active && ' (ปิดใช้งาน)'}{a.description && <div className="sub">{a.description}</div>}</td>
              <td>{a.g2}{a.g3 && <div className="sub">{a.g3}</div>}</td><td>{typeTh(a.type)}</td><td className="num">{faMoney(a.bal)}</td></tr>))}
            {view.length === 0 && <tr><td colSpan={6} className="empty">ไม่พบบัญชี</td></tr>}</tbody></table>
      </div>
      <div className="noprint" style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
        <span className="sub">หน้า {pg}/{pages}</span>
        {pg > 1 && <Link className="btn sm ghost" href={qs({ page: pg - 1 })}>ก่อนหน้า</Link>}
        {pg < pages && <Link className="btn sm ghost" href={qs({ page: pg + 1 })}>ถัดไป</Link>}
        <span className="sub">รายการต่อหน้า</span>{SIZES.map(s => <Link key={s} className={`btn sm${s === size ? '' : ' ghost'}`} href={qs({ size: s, page: 1 })}>{s}</Link>)}
        <Link className="btn sm ghost" href={qs({ all: all ? '' : '1', page: 1 })}>{all ? '✓ ' : ''}รวมบัญชีที่ปิดใช้งาน</Link>
      </div>
    </>
  );
}
