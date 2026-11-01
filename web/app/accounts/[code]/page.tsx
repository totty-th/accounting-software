import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePage } from '@/lib/auth';
import { getDb, today } from '@/lib/db';
import { GlBar } from '@/components/GlBar';
import { debitNature, faMoney, glLedgers, glRange, dmy, JOURNAL_TH, rangeParams, typeTh } from '@/lib/gl';

export const dynamic = 'force-dynamic';
type SP = { q?: string; m?: string; month?: string; year?: string; from?: string; to?: string; cancelled?: string; size?: string; page?: string; sort?: string };
const SIZES = [20, 50, 100];
export default async function Ledger({ params, searchParams }: { params: { code: string }; searchParams: SP }) {
  await requirePage('reports.read');
  const code = decodeURIComponent(params.code);
  const db = await getDb();
  const r = glRange(searchParams, today());
  const [l] = await glLedgers(db, [code], r.from, r.to, searchParams.cancelled === '1', searchParams.q ?? '');
  if (!l) notFound();
  const [a] = await db.q<any>('select description from accounts where code = $1', [code]);
  const size = SIZES.includes(Number(searchParams.size)) ? Number(searchParams.size) : 20, asc = searchParams.sort === 'asc';
  const all = asc ? l.lines : [...l.lines].reverse();   // FA เรียงวันที่ใหม่→เก่า (ยอดคงเหลือคำนวณสะสมจากเก่าไปใหม่)
  const pages = Math.max(1, Math.ceil(all.length / size)), pg = Math.min(Math.max(1, Number(searchParams.page) || 1), pages), view = all.slice((pg - 1) * size, pg * size);
  const base = { q: searchParams.q ?? '', ...rangeParams(r), cancelled: searchParams.cancelled === '1' ? '1' : '', size: String(size), sort: asc ? 'asc' : '' };
  const qs = (o: Record<string, string | number>) => `/accounts/${encodeURIComponent(code)}?` + new URLSearchParams(Object.entries({ ...base, ...o }).filter(([, v]) => v !== '' && v != null).map(([k, v]) => [k, String(v)])).toString();
  const dr = l.lines.reduce((s, x) => s + (x.cancelled && searchParams.cancelled !== '1' ? 0 : x.debit), 0), cr = l.lines.reduce((s, x) => s + x.credit, 0);
  const side = l.closing < 0 ? (debitNature(l.type) ? 'Cr.' : 'Dr.') : (debitNature(l.type) ? 'Dr.' : 'Cr.');
  return (
    <>
      <div className="top"><div><h1>{l.code} {l.name}</h1><p className="sub">{typeTh(l.type)}{a?.description ? ` · ${a.description}` : ''} · ยอดยกมา {faMoney(l.opening)}</p></div><Link className="btn ghost" href={`/accounts?${new URLSearchParams(rangeParams(r))}`}>← ผังบัญชี</Link></div>
      <GlBar mode="ledger" label={r.label} from={r.from} to={r.to} total={l.lines.length} code={code} />
      <div className="panel" style={{ padding: 0, overflowX: 'auto' }} data-report>
        <table><thead><tr><th><Link href={qs({ sort: asc ? '' : 'asc', page: 1 })}>วันที่ {asc ? '↑' : '↓'}</Link></th><th>เลขที่เอกสาร</th><th>สมุดรายวัน</th><th>คำอธิบายรายการ</th><th className="num">เดบิต</th><th className="num">เครดิต</th><th className="num">คงเหลือ</th></tr></thead>
          <tbody>{view.map((x, i) => <tr key={i} style={x.cancelled ? { opacity: 0.55, textDecoration: 'line-through' } : undefined}><td>{dmy(x.d).replace(/-/g, '/')}</td><td className="no">{x.no}</td><td>{JOURNAL_TH[x.vt] ?? x.vt}</td>
            <td>{x.memo}{x.contact && <div className="sub">{x.contact}{x.ref ? ` · ${x.ref}` : ''}</div>}</td>
            <td className="num">{x.debit ? faMoney(x.debit) : '-'}</td><td className="num">{x.credit ? faMoney(x.credit) : '-'}</td><td className="num">{faMoney(x.bal)}</td></tr>)}
            {view.length === 0 && <tr><td colSpan={7} className="empty">ไม่มีรายการในช่วงนี้</td></tr>}
            <tr data-group style={{ fontWeight: 700 }}><td /><td /><td /><td>รวมในช่วง · ยอดคงเหลือ ({side})</td><td className="num">{faMoney(dr)}</td><td className="num">{faMoney(cr)}</td><td className="num">{faMoney(l.closing)}</td></tr></tbody></table>
      </div>
      <div className="noprint" style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
        <span className="sub">หน้า {pg}/{pages}</span>
        {pg > 1 && <Link className="btn sm ghost" href={qs({ page: pg - 1 })}>ก่อนหน้า</Link>}
        {pg < pages && <Link className="btn sm ghost" href={qs({ page: pg + 1 })}>ถัดไป</Link>}
        <span className="sub">รายการต่อหน้า</span>{SIZES.map(s => <Link key={s} className={`btn sm${s === size ? '' : ' ghost'}`} href={qs({ size: s, page: 1 })}>{s}</Link>)}
      </div>
    </>
  );
}
