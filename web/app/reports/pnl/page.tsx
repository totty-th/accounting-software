import { requirePage } from '@/lib/auth';
import { getDb, today, monthStart } from '@/lib/db';
import { money } from '@/lib/format';
import { Group } from '@/components/Board';

export default async function Pnl({ searchParams }: { searchParams: { from?: string; to?: string } }) {
  await requirePage('reports.read');
  const from = searchParams.from || monthStart(), to = searchParams.to || today();
  const db = await getDb();
  const rows = await db.q(`select * from income_statement($1::date,$2::date)`, [from, to]);
  const rev = rows.filter(r => r.section === 'revenue'), exp = rows.filter(r => r.section === 'expense');
  const tr = rev.reduce((s, r) => s + Number(r.amount), 0), te = exp.reduce((s, r) => s + Number(r.amount), 0);
  const tbl = (rs: typeof rows, label: string, total: number) => (
    <table><thead><tr><th>รหัส</th><th>{label}</th><th className="num">จำนวนเงิน</th></tr></thead>
      <tbody>{rs.map(r => <tr key={r.code}><td className="no">{r.code}</td><td>{r.name}</td><td className="num">{money(r.amount)}</td></tr>)}
        <tr style={{ fontWeight: 700 }}><td /><td>รวม{label}</td><td className="num">{money(total)}</td></tr></tbody></table>);
  return (
    <>
      <div className="top"><div><h1>งบกำไรขาดทุน</h1></div></div>
      <form className="row-inline" method="get">
        <label className="f">ตั้งแต่<input type="date" name="from" defaultValue={from} /></label>
        <label className="f">ถึง<input type="date" name="to" defaultValue={to} /></label>
        <button className="btn">ดูรายงาน</button>
      </form>
      <Group title="รายได้" color="var(--green)" count={rev.length}>{rev.length ? tbl(rev, 'รายได้', tr) : <div className="empty">ไม่มีรายได้ในช่วงนี้</div>}</Group>
      <Group title="ต้นทุนและค่าใช้จ่าย" color="var(--orange)" count={exp.length}>{exp.length ? tbl(exp, 'ค่าใช้จ่าย', te) : <div className="empty">ไม่มีค่าใช้จ่ายในช่วงนี้</div>}</Group>
      <div className="cards"><div className="card" style={{ ['--c' as any]: tr - te >= 0 ? 'var(--teal)' : 'var(--red)' }}>
        <span>{tr - te >= 0 ? 'กำไรสุทธิ' : 'ขาดทุนสุทธิ'}</span><b>{money(tr - te)}</b></div></div>
    </>
  );
}
