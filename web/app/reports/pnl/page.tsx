import { requirePage } from '@/lib/auth';
import { getDb, today } from '@/lib/db';
import { buildPnl } from '@/lib/statements';
import { fiscalYears, yearOf } from '@/lib/fiscal';
import { dateTh } from '@/lib/format';
import { StatementRows, StatementHead, stmtFmt } from '@/components/Statement';
import { ReportTools } from '@/components/ReportTools';

export const dynamic = 'force-dynamic';
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const shiftYear = (d: string, n: number) => `${Number(d.slice(0, 4)) + n}${d.slice(4)}`;
export default async function Pnl({ searchParams: sp }: { searchParams: { year?: string; from?: string; to?: string; cmp?: string; zero?: string; show?: string } }) {
  await requirePage('reports.read');
  const db = await getDb();
  const years = await fiscalYears(db, today()), year = yearOf(sp.year, years), cmp = sp.cmp === '1', zero = sp.zero === '1', shown = sp.show === '1';
  const custom = ISO.test(sp.from ?? '') && ISO.test(sp.to ?? '') && sp.from! <= sp.to!;
  const from = custom ? sp.from! : `${year}-01-01`, to = custom ? sp.to! : `${year}-12-31`;
  const cur = shown ? await db.q<any>('select * from income_statement($1::date,$2::date)', [from, to]) : [];
  const prev = shown && cmp ? await db.q<any>('select * from income_statement($1::date,$2::date)', [shiftYear(from, -1), shiftYear(to, -1)]) : null;
  const accts = shown && zero ? await db.q<any>('select code, name, type from accounts where is_active order by code') : [];
  const p = buildPnl(cur, prev, accts);
  const [co] = await db.q<any>('select name from company_profile');
  const label = custom ? `${dateTh(from)} - ${dateTh(to)}` : String(year);
  return (
    <>
      <div className="top"><div><h1>งบกำไรขาดทุน</h1></div></div>
      <form className="row-inline noprint" method="get">
        <label className="f">รอบระยะเวลารายงาน<select name="year" defaultValue={year}>{years.map(y => <option key={y} value={y}>{y}</option>)}</select></label>
        <label className="f">หรือช่วงวันที่ ตั้งแต่<input type="date" name="from" defaultValue={custom ? from : ''} /></label>
        <label className="f">ถึง<input type="date" name="to" defaultValue={custom ? to : ''} /></label>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" name="cmp" value="1" defaultChecked={cmp} style={{ width: 'auto' }} /> เปรียบเทียบกับรอบเวลาก่อนหน้า</label>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" name="zero" value="1" defaultChecked={zero} style={{ width: 'auto' }} /> แสดงรายการยอดศูนย์</label>
        <input type="hidden" name="show" value="1" /><button className="btn">แสดงผลรายงาน</button>
      </form>
      {!shown ? <div className="panel empty">เลือก "รอบระยะเวลารายงาน" ที่ต้องการค้นหา แล้วคลิกที่ "แสดงผลรายงาน"</div> : <>
        <ReportTools title="งบกำไรขาดทุน" meta={[['รอบระยะเวลา', label]]} />
        <div className="panel" data-report style={{ padding: 0, overflowX: 'auto' }}>
          <p style={{ textAlign: 'center', margin: '14px 0 0' }}><b>{co?.name ?? ''}</b><br />งบกำไรขาดทุน<br /><span className="sub">สำหรับรอบ {dateTh(from)} - {dateTh(to)} · ไม่รวมใบปิดงวดบัญชี (CP)</span></p>
          <table>
            <StatementHead cmp={cmp} cur={label} prev={custom ? `${dateTh(shiftYear(from, -1))} - ${dateTh(shiftYear(to, -1))}` : String(year - 1)} />
            <tbody>
              <StatementRows title="รายได้" sections={p.revenue.sections} total={p.revenue} totalLabel="รวม รายได้" cmp={cmp} expand />
              <StatementRows title="ค่าใช้จ่าย" sections={p.expense.sections} total={p.expense} totalLabel="รวม ค่าใช้จ่าย" cmp={cmp} expand />
              <tr data-group><td style={{ fontWeight: 700 }}>{p.net >= 0 ? 'กำไร (ขาดทุน) สุทธิ' : 'กำไร (ขาดทุน) สุทธิ'}</td>
                <td className="num" style={{ fontWeight: 700 }}>{stmtFmt(p.net)}</td>{cmp && <td className="num" style={{ fontWeight: 700 }}>{stmtFmt(p.netPrev)}</td>}</tr>
            </tbody></table>
        </div></>}
    </>
  );
}
