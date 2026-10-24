import { requirePage } from '@/lib/auth';
import { getDb, today, monthStart } from '@/lib/db';
import { money } from '@/lib/format';
import { Group } from '@/components/Board';

export default async function TB({ searchParams }: { searchParams: { from?: string; to?: string; zero?: string } }) {
  await requirePage('reports.read');
  const from = searchParams.from || monthStart(), to = searchParams.to || today(), zero = searchParams.zero === '1';
  const db = await getDb();
  const rows = await db.q(`select * from trial_balance($1::date,$2::date,$3)`, [from, to, zero]);
  const sum = (k: string) => rows.reduce((s, r) => s + Number(r[k]), 0);
  const dr = rows.reduce((s, r) => s + Math.max(Number(r.closing), 0), 0), cr = rows.reduce((s, r) => s + Math.max(-Number(r.closing), 0), 0);
  return (
    <>
      <div className="top"><div><h1>งบทดลอง</h1><p className="sub">ยอดยกมา เคลื่อนไหวในงวด และยอดสะสม</p></div></div>
      <form className="row-inline" method="get">
        <label className="f">ตั้งแต่<input type="date" name="from" defaultValue={from} /></label>
        <label className="f">ถึง<input type="date" name="to" defaultValue={to} /></label>
        <label className="f" style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 6, flexDirection: 'row' }}>
          <input type="checkbox" name="zero" value="1" defaultChecked={zero} style={{ width: 'auto' }} /> แสดงยอดศูนย์</label>
        <button className="btn">ดูรายงาน</button>
      </form>
      <Group title={`งบทดลอง ${from} ถึง ${to}`} color="var(--red)" count={rows.length}>
        <table><thead><tr><th>รหัส</th><th>ชื่อบัญชี</th><th className="num">ยอดยกมา</th><th className="num">เดบิต</th><th className="num">เครดิต</th><th className="num">คงเหลือ (Dr+/Cr−)</th></tr></thead>
          <tbody>{rows.map(r => (
            <tr key={r.code}><td className="no">{r.code}</td><td>{r.name}</td><td className="num">{money(r.opening)}</td>
              <td className="num">{money(r.period_dr)}</td><td className="num">{money(r.period_cr)}</td><td className="num">{money(r.closing)}</td></tr>))}
            <tr style={{ fontWeight: 700 }}><td /><td>รวม</td><td className="num">{money(sum('opening'))}</td><td className="num">{money(sum('period_dr'))}</td><td className="num">{money(sum('period_cr'))}</td>
              <td className="num" title="เดบิตคงเหลือรวม = เครดิตคงเหลือรวม">{Math.abs(dr - cr) < 0.005 ? '✓ สมดุล' : 'ไม่สมดุล'}</td></tr></tbody></table>
      </Group>
    </>
  );
}
