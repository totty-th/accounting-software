import { requirePage } from '@/lib/auth';
import { getDb, today } from '@/lib/db';
import { buildBalanceSheet } from '@/lib/statements';
import { fiscalYears, yearOf } from '@/lib/fiscal';
import { StatementRows, StatementHead, stmtFmt as fmt } from '@/components/Statement';
import { ReportTools } from '@/components/ReportTools';

export const dynamic = 'force-dynamic';
export default async function BalanceSheet({ searchParams: sp }: { searchParams: { year?: string; cmp?: string; zero?: string; show?: string } }) {
  await requirePage('reports.read');
  const db = await getDb();
  const years = await fiscalYears(db, today()), year = yearOf(sp.year, years), cmp = sp.cmp === '1', zero = sp.zero === '1', shown = sp.show === '1';
  const cur = shown ? await db.q<any>('select * from balance_sheet($1::date)', [`${year}-12-31`]) : [];
  const prev = shown && cmp ? await db.q<any>('select * from balance_sheet($1::date)', [`${year - 1}-12-31`]) : null;
  const accts = shown && zero ? await db.q<any>('select code, name, type from accounts where is_active order by code') : [];
  const bs = buildBalanceSheet(cur, prev, accts);
  const [co] = await db.q<any>('select name from company_profile');
  return (
    <>
      <div className="top"><div><h1>งบฐานะการเงิน</h1></div></div>
      <form className="row-inline noprint" method="get">
        <label className="f">รอบระยะเวลารายงาน<select name="year" defaultValue={year}>{years.map(y => <option key={y} value={y}>{y}</option>)}</select></label>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" name="cmp" value="1" defaultChecked={cmp} style={{ width: 'auto' }} /> เปรียบเทียบกับรอบเวลาก่อนหน้า</label>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" name="zero" value="1" defaultChecked={zero} style={{ width: 'auto' }} /> แสดงรายการยอดศูนย์</label>
        <input type="hidden" name="show" value="1" /><button className="btn">แสดงผลรายงาน</button>
      </form>
      {!shown ? <div className="panel empty">เลือก "รอบระยะเวลารายงาน" ที่ต้องการค้นหา แล้วคลิกที่ "แสดงผลรายงาน"</div> : <>
        <ReportTools title="งบฐานะการเงิน" meta={[['ณ วันที่', `31/12/${year}`]]} />
        <div className="panel" data-report style={{ padding: 0, overflowX: 'auto' }}>
          <p style={{ textAlign: 'center', margin: '14px 0 0' }}><b>{co?.name ?? ''}</b><br />งบฐานะการเงิน<br /><span className="sub">ณ วันที่ 31 ธันวาคม {year}</span></p>
          <table>
            <StatementHead cmp={cmp} cur={String(year)} prev={String(year - 1)} />
            <tbody>
              <StatementRows title="สินทรัพย์" sections={bs.asset.sections} total={bs.asset} totalLabel="รวมสินทรัพย์" cmp={cmp} expand={false} />
              <StatementRows title="หนี้สิน" sections={bs.liability.sections} total={bs.liability} totalLabel="รวมหนี้สิน" cmp={cmp} expand={false} />
              <StatementRows title="ส่วนของผู้ถือหุ้น" sections={bs.equity.sections} total={bs.equity} totalLabel="รวมส่วนของผู้ถือหุ้น/ส่วนของผู้เป็นหุ้นส่วน" cmp={cmp} expand />
              <tr data-group><td style={{ fontWeight: 700 }}>รวมหนี้สินและส่วนของผู้ถือหุ้น</td>
                <td className="num" style={{ fontWeight: 700 }}>{fmt(bs.liability.amount + bs.equity.amount)}</td>{cmp && <td className="num" style={{ fontWeight: 700 }}>{fmt(bs.liability.prev + bs.equity.prev)}</td>}</tr>
            </tbody></table>
        </div></>}
    </>
  );
}
