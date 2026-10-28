import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePage } from '@/lib/auth';
import { getDb, today } from '@/lib/db';
import { money } from '@/lib/format';
import { ReportTools } from '@/components/ReportTools';

export const dynamic = 'force-dynamic';
export default async function Ledger({ params, searchParams }: { params: { code: string }; searchParams: { from?: string; to?: string; year?: string } }) {
  await requirePage('reports.read');
  const code = decodeURIComponent(params.code);
  const db = await getDb();
  const [a] = await db.q<any>('select code, name, type, description from accounts where code=$1', [code]);
  if (!a) notFound();
  const y = /^\d{4}$/.test(searchParams.year ?? '') ? searchParams.year! : today().slice(0, 4);
  const from = searchParams.from || `${y}-01-01`, to = searchParams.to || `${y}-12-31`;
  const rows = await db.q<any>('select * from account_ledger($1,$2::date,$3::date)', [code, from, to]);
  const dr = rows.reduce((s, r) => s + Number(r.debit), 0), cr = rows.reduce((s, r) => s + Number(r.credit), 0);
  const end = rows.length ? Number(rows[rows.length - 1].balance) : 0;
  return (
    <>
      <div className="top"><div><h1>{a.code} {a.name}</h1><p className="sub">บัญชีแยกประเภท{a.description ? ` · ${a.description}` : ''}</p></div><Link className="btn ghost" href="/accounts">← ผังบัญชี</Link></div>
      <form className="row-inline" method="get">
        <label className="f">ตั้งแต่<input type="date" name="from" defaultValue={from} /></label>
        <label className="f">ถึง<input type="date" name="to" defaultValue={to} /></label>
        <button className="btn">ดูรายงาน</button>
      </form>
      <ReportTools title={`บัญชีแยกประเภท ${a.code} ${a.name}`} meta={[['ตั้งแต่', from], ['ถึง', to]]} />
      <div className="panel" style={{ padding: 0, overflowX: 'auto' }} data-report>
        <table><thead><tr><th>วันที่</th><th>เลขที่ใบสำคัญ</th><th>คำอธิบาย</th><th className="num">เดบิต</th><th className="num">เครดิต</th><th className="num">คงเหลือ</th></tr></thead>
          <tbody>{rows.map((r, i) => <tr key={i}><td>{r.entry_date ? String(r.entry_date instanceof Date ? r.entry_date.toISOString().slice(0, 10) : r.entry_date).slice(0, 10) : ''}</td><td className="no">{r.voucher_no}</td><td>{r.memo}</td>
            <td className="num">{Number(r.debit) ? money(r.debit) : ''}</td><td className="num">{Number(r.credit) ? money(r.credit) : ''}</td><td className="num">{money(r.balance)}</td></tr>)}
            <tr data-group style={{ fontWeight: 700 }}><td /><td>รวม</td><td /><td className="num">{money(dr)}</td><td className="num">{money(cr)}</td><td className="num">{money(end)}</td></tr></tbody></table>
      </div>
    </>
  );
}
