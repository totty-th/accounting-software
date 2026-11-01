import Link from 'next/link';
import { getDb, today } from '@/lib/db';
import { money, dateTh, partyName } from '@/lib/format';
import { periodRange } from '@/lib/period';
import { reportPeriod, pickStatuses, periodLabel } from '@/lib/report-filter';
import { ReportFilter } from '@/components/ReportFilter';
import { requirePage } from '@/lib/auth';
import { ReportTools } from '@/components/ReportTools';
import { PO_BUCKETS, PO_LABEL, PO_OPTS, PO_TONE, poRows } from '@/lib/purchase-reports';

export const dynamic = 'force-dynamic';
type Sp = { period?: string; from?: string; to?: string; st?: string | string[] };
// รายงานใบสั่งซื้อ (ตามต้นแบบ REA 1-11-2026): ตัวกรองช่วงเวลา + สถานะ (รออนุมัติ/อนุมัติ/ดำเนินการแล้ว/ไม่อนุมัติ/แบ่งจ่าย) · มูลค่าก่อน VAT
export default async function PoReport({ searchParams }: { searchParams: Sp }) {
  await requirePage('reports.read');
  const period = reportPeriod(searchParams.period), { sel, list } = pickStatuses(searchParams.st, PO_BUCKETS);
  const t = today(), range = periodRange(period, t, searchParams.from, searchParams.to);
  void getDb;
  const rows = await poRows(range, list);
  const sum = (k: string) => rows.reduce((s, r) => s + Number(r[k]), 0);
  return (<>
    <div className="top"><div><h1>รายงานใบสั่งซื้อ</h1><p className="sub">มูลค่าก่อน VAT · ใบสั่งซื้อที่ยกเลิกไม่แสดง</p></div></div>
    <ReportFilter period={period} from={searchParams.from} to={searchParams.to} selected={sel} groups={[{ label: '', options: PO_OPTS }]} />
    <ReportTools exportBase="/reports/purchase-orders/export" title="รายงานใบสั่งซื้อ" meta={[['ช่วงเวลา :', periodLabel(range)]]} />
    <section className="panel" style={{ padding: 16, marginBottom: 12, display: 'flex', flexWrap: 'wrap', gap: 24, justifyContent: 'space-between' }}>
      <div><div className="sub">ช่วงเวลา</div><b>{periodLabel(range)}</b><div className="sub" style={{ marginTop: 6 }}>จำนวนทั้งหมด</div><b>{rows.length} เอกสาร</b></div>
      <table style={{ minWidth: 0, width: 300 }}><tbody>
        <tr><td>ยอดรวมทั้งสิ้น</td><td className="num"><b>{money(sum('total'))}</b></td></tr><tr><td>ภาษีมูลค่าเพิ่ม</td><td className="num">{money(sum('vat'))}</td></tr>
        <tr><td>ยอดรวมก่อนภาษี</td><td className="num">{money(sum('subtotal'))}</td></tr></tbody></table>
    </section>
    <div data-report className="panel" style={{ padding: 0, overflowX: 'auto' }}>
      {rows.length === 0 ? <div className="empty">ไม่มีข้อมูลในช่วงที่เลือก</div> :
        <table><thead><tr><th>เลขที่เอกสาร</th><th>วันที่</th><th>ชื่อผู้จำหน่าย/ชื่อโปรเจ็ค</th><th className="num">มูลค่า</th><th className="num">ภาษีมูลค่าเพิ่ม</th><th className="num">ยอดรวมสุทธิ</th><th>สถานะ</th></tr></thead>
          <tbody>{rows.map(r => <tr key={r.id}><td className="no"><span className="cdot" style={{ background: PO_TONE[r.status] }} /><Link href={`/purchases/orders/${r.id}`}>{r.po_no}</Link></td><td>{dateTh(r.po_date)}</td>
            <td>{partyName(r)}{r.project ? ` / ${r.project}` : ''}</td><td className="num">{money(r.subtotal)}</td><td className="num">{money(r.vat)}</td><td className="num">{money(r.total)}</td>
            <td><span className="cpill" style={{ ['--c' as any]: PO_TONE[r.status] }}>{PO_LABEL[r.status] ?? r.status}</span></td></tr>)}
            <tr style={{ fontWeight: 700 }}><td colSpan={3}>ยอดรวมทั้งหมด</td><td className="num">{money(sum('subtotal'))}</td><td className="num">{money(sum('vat'))}</td><td className="num">{money(sum('total'))}</td><td /></tr></tbody></table>}
    </div></>);
}
