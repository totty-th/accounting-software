import Link from 'next/link';
import { getDb, today } from '@/lib/db';
import { money, dateTh, partyName } from '@/lib/format';
import { Pill } from '@/components/Pill';
import { STATUS } from '@/lib/status';
import { periodRange } from '@/lib/period';
import { reportPeriod } from '@/lib/report-filter';
import { ReportFilter } from '@/components/ReportFilter';
import { parseStatuses } from '@/lib/status-filter';
import { requirePage } from '@/lib/auth';

export const dynamic = 'force-dynamic';
type Sp = { period?: string; from?: string; to?: string; st?: string | string[] };
// รายงานใบวางบิล (ตามต้นแบบ): แสดงใบวางบิลทุกสถานะที่เลือก แต่ยอดรวมไม่นับใบที่ยกเลิก · ใบวางบิลไม่ลงบัญชี (เป็นเอกสารเรียกเก็บ ไม่ใช่รายได้)
const STATUSES = ['billed', 'receipt_opened', 'collected', 'cancelled'];

export default async function BillingReport({ searchParams }: { searchParams: Sp }) {
  await requirePage('reports.read');
  const period = reportPeriod(searchParams.period);
  const st = parseStatuses(searchParams.st, STATUSES);
  const t = today();
  const range = periodRange(period, t, searchParams.from, searchParams.to);
  const db = await getDb();
  const rows = await db.q(`select d.id, d.doc_no, d.doc_date, d.status, d.subtotal, d.vat, d.total, c.business_name, c.contact_name
    from sales_docs d join contacts c on c.id=d.contact_id
    where d.doc_type='BL' and ($1::date is null or d.doc_date>=$1::date) and ($2::date is null or d.doc_date<=$2::date)
      and (cardinality($3::text[])=0 or d.status = any($3::text[]))
    order by d.doc_date desc, d.doc_no desc`, [range?.[0] ?? null, range?.[1] ?? null, `{${st.join(',')}}`]);
  const live = rows.filter(r => r.status !== 'cancelled');
  const sum = (k: string) => live.reduce((s, r) => s + Number(r[k]), 0);
  return (
    <>
      <div className="top"><div><h1>รายงานใบวางบิล</h1><p className="sub">ยอดรวมไม่นับใบที่ยกเลิก · ใบวางบิลไม่ลงบัญชีรายได้</p></div></div>
      <ReportFilter period={period} from={searchParams.from} to={searchParams.to} groups={[{ label: 'เอกสารวางบิล', options: STATUSES.map(x => [x, STATUS[x]?.[0] ?? x] as [string, string]) }]} selected={st} />
      <div className="panel">
        <div className="sub">ณ วันที่ {dateTh(t)} · ช่วงเวลา {range ? `${dateTh(range[0])} - ${dateTh(range[1])}` : 'ทั้งหมด'} · {live.length} เอกสาร{rows.length !== live.length ? ` (ยกเลิก ${rows.length - live.length} ไม่นับยอด)` : ''}</div>
        <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', marginTop: 8 }}>
          <div><div className="sub">ยอดรวมก่อนภาษี</div><strong>{money(sum('subtotal'))}</strong></div>
          <div><div className="sub">ภาษีมูลค่าเพิ่ม</div><strong>{money(sum('vat'))}</strong></div>
          <div><div className="sub">ยอดรวมทั้งสิ้น</div><strong>{money(sum('total'))}</strong></div>
        </div>
      </div>
      <div className="panel" style={{ padding: 0, overflowX: 'auto', marginTop: 14 }}>
        {rows.length === 0 ? <div className="empty">ไม่มีข้อมูลในช่วงที่เลือก</div> :
          <table><thead><tr><th>เลขที่เอกสาร</th><th>วันที่</th><th>ลูกค้า</th><th className="num">มูลค่า</th><th className="num">ภาษีมูลค่าเพิ่ม</th><th className="num">ยอดรวมสุทธิ</th><th>สถานะ</th></tr></thead>
            <tbody>{rows.map(r => <tr key={r.id} style={r.status === 'cancelled' ? { opacity: .55 } : undefined}><td className="no"><Link href={`/sales/${r.doc_no}`}>{r.doc_no}</Link></td><td>{dateTh(r.doc_date)}</td><td>{partyName(r)}</td>
              <td className="num">{money(r.subtotal)}</td><td className="num">{money(r.vat)}</td><td className="num">{money(r.total)}</td><td><Pill s={r.status} /></td></tr>)}</tbody></table>}
      </div>
    </>
  );
}
