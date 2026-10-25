import Link from 'next/link';
import { requirePage } from '@/lib/auth';
import { getDb, today } from '@/lib/db';
import { money, dateTh } from '@/lib/format';
import { periodRange } from '@/lib/period';
import { reportPeriod, pickStatuses } from '@/lib/report-filter';
import { whtRows } from '@/lib/tax-report';
import { ReportFilter } from '@/components/ReportFilter';
import { ReportTools } from '@/components/ReportTools';
import { Kebab } from '@/components/TaxBits';

export const dynamic = 'force-dynamic';
const BUCKETS: Record<string, string[]> = { done: ['active'], cancelled: ['cancelled'] };
const ST_OPTS: [string, string][] = [['done', 'ดำเนินการแล้ว'], ['cancelled', 'ยกเลิก']];

// รายงานภาษีหัก ณ ที่จ่าย (แบบ FA): หัวรายงานสรุปมูลค่ารวม/ภาษีที่หักรวม (ไม่นับใบที่ยกเลิก) · "รอดำเนินการ" ของ FA ยังไม่มีเทียบเท่า (ระบบเราออกหนังสือรับรองตอนจ่ายเงินเสมอ)
export default async function WhtReport({ searchParams }: { searchParams: { period?: string; from?: string; to?: string; st?: string | string[] } }) {
  await requirePage('reports.read');
  const period = reportPeriod(searchParams.period);
  const { sel, list } = pickStatuses(searchParams.st, BUCKETS);
  const range = periodRange(period, today(), searchParams.from, searchParams.to);
  const rows = await whtRows(await getDb(), range, list);
  const live = rows.filter(r => r.status === 'active');
  const tb = live.reduce((a, r) => a + r.base, 0), tw = live.reduce((a, r) => a + r.wht, 0);
  const co = (await (await getDb()).q<any>('select name from company_profile'))[0];
  return (
    <>
      <div className="top"><div><h1>รายงานภาษีหัก ณ ที่จ่าย</h1></div></div>
      <ReportFilter period={period} from={searchParams.from} to={searchParams.to} groups={[{ label: '', options: ST_OPTS }]} selected={sel} />
      <ReportTools exportBase="/reports/wht/export" title="รายงานภาษีหัก ณ ที่จ่าย" />
      <div className="panel"><div className="taxhead"><div>
        <h2 style={{ margin: 0 }}>{co?.name ?? ''}</h2>
        <div className="sub">ณ วันที่ {dateTh(today())}</div>
        <div className="sub">ช่วงเวลา {range ? `${dateTh(range[0])} - ${dateTh(range[1])}` : 'ทั้งหมด'}</div>
        <div className="sub">เลขที่ {rows.length ? `${rows[0].no} - ${rows[rows.length - 1].no}` : '-'}</div></div>
        <div className="taxsum"><div className="sub">มูลค่ารวม<b>{money(tb)}</b></div><div className="sub">หัก ณ ที่จ่ายรวม<b>{money(tw)}</b></div></div></div></div>
      <div data-report className="panel" style={{ padding: 0, overflowX: 'auto', marginTop: 4 }}>
        {rows.length === 0 ? <div className="empty">ไม่มีรายการหัก ณ ที่จ่ายในช่วงที่เลือก</div> :
          <table><thead><tr><th>วันที่</th><th>เลขที่เอกสาร</th><th>ชื่อผู้ถูกหัก ณ ที่จ่าย</th><th>แบบฟอร์ม</th><th className="num">มูลค่า</th><th className="num">ภาษีที่หัก</th><th /></tr></thead>
            <tbody>{rows.map(r => (
              <tr key={r.id} style={r.status === 'cancelled' ? { opacity: .55 } : undefined}>
                <td>{dateTh(r.date)}</td>
                <td className="no"><span className={`dot ${r.status === 'active' ? 'dot-blue' : 'dot-red'}`} title={r.status === 'active' ? 'ดำเนินการแล้ว' : 'ยกเลิก'} />{r.no}
                  {r.exp_no && <span className="sub"> · <Link href={`/expenses/${r.exp_id}`}>{r.exp_no}</Link></span>}</td>
                <td>{r.name}</td><td>{r.form}</td><td className="num">{money(r.base)}</td><td className="num">{money(r.wht)}</td>
                <td><Kebab print={r.status === 'active' ? `/wht/${r.id}/pdf` : undefined} download={r.status === 'active' ? `/wht/${r.id}/pdf?download=1` : undefined} /></td></tr>))}</tbody></table>}
      </div>
    </>
  );
}
