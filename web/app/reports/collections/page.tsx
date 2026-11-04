import Link from 'next/link';
import { getDb, today } from '@/lib/db';
import { money, dateTh, partyName } from '@/lib/format';
import { Pill } from '@/components/Pill';
import { DOC_TYPE, STATUS } from '@/lib/status';
import { periodRange } from '@/lib/period';
import { reportPeriod } from '@/lib/report-filter';
import { ReportFilter } from '@/components/ReportFilter';
import { parseStatuses } from '@/lib/status-filter';
import { requirePage } from '@/lib/auth';
import { COLLECTION_SQL } from '@/lib/collection-report';
import { ReportTools } from '@/components/ReportTools';

export const dynamic = 'force-dynamic';
type Sp = { period?: string; from?: string; to?: string; st?: string | string[] };
// รายงานการเก็บเงิน (ตามต้นแบบ): ใบแจ้งหนี้/ขายสด/ใบเพิ่มหนี้ + สถานะการเก็บเงิน + ช่องทางรับชำระ · ยอดรวมไม่นับใบที่ยกเลิก
const STATUSES = ['pending_collect', 'awaiting_payment', 'split_paid', 'receipt_opened', 'collected', 'cancelled'];
const METHOD: Record<string, string> = { cash: 'เงินสด', transfer: 'โอนเงิน', cheque: 'เช็ค', card: 'บัตร', other: 'อื่นๆ' };

export default async function CollectionReport({ searchParams }: { searchParams: Sp }) {
  await requirePage('reports.read');
  const period = reportPeriod(searchParams.period);
  const st = parseStatuses(searchParams.st, STATUSES);
  const t = today();
  const range = periodRange(period, t, searchParams.from, searchParams.to);
  const db = await getDb();
  const rows = await db.q(COLLECTION_SQL, [range?.[0] ?? null, range?.[1] ?? null, `{${st.join(',')}}`]);
  const live = rows.filter(r => r.status !== 'cancelled');
  const total = live.reduce((s, r) => s + Number(r.total), 0);
  return (
    <>
      <div className="top"><div><h1>รายงานการเก็บเงิน</h1><p className="sub">ใบแจ้งหนี้ · ขายสด · ใบเพิ่มหนี้ · ยอดรวมไม่นับใบที่ยกเลิก</p></div></div>
      <ReportFilter period={period} from={searchParams.from} to={searchParams.to} groups={[{ label: 'เอกสารขาย', options: STATUSES.map(x => [x, STATUS[x]?.[0] ?? x] as [string, string]) }]} selected={st} />
      <div className="panel">
        <div className="sub">ณ วันที่ {dateTh(t)} · ช่วงเวลา {range ? `${dateTh(range[0])} - ${dateTh(range[1])}` : 'ทั้งหมด'} · {live.length} เอกสาร{rows.length !== live.length ? ` (ยกเลิก ${rows.length - live.length} ไม่นับยอด)` : ''}</div>
        <div style={{ marginTop: 8 }}><div className="sub">ยอดรวมทั้งสิ้น</div><strong>{money(total)}</strong></div>
      </div>
      <ReportTools title="รายงานการเก็บเงิน" meta={[['ช่วงเวลา :', range ? `${dateTh(range[0])} - ${dateTh(range[1])}` : 'ทั้งหมด']]} />
      <div data-report className="panel" style={{ padding: 0, overflowX: 'auto', marginTop: 4 }}>
        {rows.length === 0 ? <div className="empty">ไม่มีข้อมูลในช่วงที่เลือก</div> :
          <table><thead><tr><th>เลขที่เอกสาร</th><th>ประเภท</th><th>วันที่</th><th>ลูกค้า</th><th>ช่องทางรับชำระ</th><th className="num">ยอดรวมสุทธิ</th><th>สถานะ</th></tr></thead>
            <tbody>{rows.map(r => <tr key={r.id} style={r.status === 'cancelled' ? { opacity: .55 } : undefined}><td className="no"><Link href={`/sales/${r.doc_no}`}>{r.doc_no}</Link></td><td>{DOC_TYPE[r.doc_type]}</td><td>{dateTh(r.doc_date)}</td><td>{partyName(r)}</td>
              <td>{r.methods ? String(r.methods).split(',').map((m: string) => METHOD[m] ?? m).join(', ') : '-'}</td><td className="num">{money(r.total)}</td><td><Pill s={r.status} /></td></tr>)}</tbody></table>}
      </div>
    </>
  );
}
