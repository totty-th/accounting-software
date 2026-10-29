import Link from 'next/link';
import { Fragment } from 'react';
import { requirePage } from '@/lib/auth';
import { getDb, today } from '@/lib/db';
import { money, dateTh, dateIso } from '@/lib/format';
import { periodRange } from '@/lib/period';
import { reportPeriod, pickStatuses, SALES_BUCKETS, periodLabel } from '@/lib/report-filter';
import { salesTaxRows, totals, filingInfo } from '@/lib/tax-report';
import { ReportFilter } from '@/components/ReportFilter';
import { ReportTools } from '@/components/ReportTools';
import { Dot, RelPop, Kebab } from '@/components/TaxBits';

export const dynamic = 'force-dynamic';
type Sp = { period?: string; from?: string; to?: string; st?: string | string[] };
const ST_OPTS: [string, string][] = [['wait', 'รอเก็บเงิน'], ['done', 'เก็บเงินแล้ว'], ['rcpt', 'เปิดใบเสร็จแล้ว'], ['split', 'แบ่งจ่าย'], ['ok', 'อนุมัติแล้ว/ใช้งาน'], ['cancelled', 'ยกเลิก']];
const PAGE = 30;

// รายงานภาษีขายตามเอกสาร (แบบ FA): INV/ขายสด/ใบเพิ่มหนี้ เป็นบวก, ใบลดหนี้เป็นลบ · ใบมัดจำรวมด้วย (เป็นใบกำกับภาษี) · ใบยกเลิกแสดงได้แต่ไม่นับในยอดรวม
export default async function SalesTax({ searchParams }: { searchParams: Sp & { page?: string } }) {
  await requirePage('reports.read');
  const period = reportPeriod(searchParams.period);
  const { sel, list } = pickStatuses(searchParams.st, SALES_BUCKETS);
  const range = periodRange(period, today(), searchParams.from, searchParams.to);
  const db = await getDb();
  const rows = await salesTaxRows(db, range, list, sel.length === 0 || list.includes('cancelled'));
  const filing = await filingInfo(db);
  const t = totals(rows);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE)), pg = Math.min(pages, Math.max(1, Number(searchParams.page) || 1));
  const shown = rows.slice((pg - 1) * PAGE, pg * PAGE);
  const q = (p: number) => { const u = new URLSearchParams(); if (searchParams.period) u.set('period', searchParams.period); if (searchParams.from) u.set('from', searchParams.from); if (searchParams.to) u.set('to', searchParams.to); sel.forEach(s => u.append('st', s)); u.set('page', String(p)); return `/reports/sales-tax?${u}`; };
  const co = (await db.q<any>('select name, tax_id from company_profile'))[0];
  return (
    <>
      <div className="top"><div><h1>รายงานภาษีขายตามเอกสาร</h1><p className="sub">ใบลดหนี้เป็นลบ · ใบมัดจำรวมในรายงานนี้ (เป็นใบกำกับภาษี) · ใบที่ยกเลิกแสดงแต่ไม่นับในยอดรวม</p></div></div>
      <ReportFilter period={period} from={searchParams.from} to={searchParams.to} groups={[{ label: '', options: ST_OPTS }]} selected={sel} />
      <ReportTools exportBase="/reports/sales-tax/export" modes={[['doc', 'Excel (ภาษีขายตามเอกสาร)'], ['rate', 'Excel (แยกอัตราภาษี)'], ['output', 'Excel (ภาษีขาย ภ.พ.30)']]} title="รายงานภาษีขายตามเอกสาร" />
      <div className="panel">
        <div className="taxhead"><div>
          <div className="sub">เดือนภาษี/ช่วงเวลา: <b>{periodLabel(range)}</b></div>
          <div className="sub">ชื่อผู้ประกอบการ {co?.name ?? '-'} · เลขประจำตัวผู้เสียภาษี {co?.tax_id ?? '-'} (สำนักงานใหญ่)</div></div>
          <div className="taxsum"><div className="sub">มูลค่า<b>{money(t.sub)}</b></div><div className="sub">ภาษีมูลค่าเพิ่ม<b>{money(t.vat)}</b></div></div></div>
      </div>
      <div data-report className="panel" style={{ padding: 0, overflowX: 'auto', marginTop: 4 }}>
        {rows.length === 0 ? <div className="empty">ไม่มีเอกสารในช่วงที่เลือก</div> :
          <table><thead><tr><th>วันที่</th><th>เลขที่เอกสาร</th><th>ชื่อลูกค้า/ชื่อโปรเจ็ค</th><th>เลขผู้เสียภาษี</th><th>สาขา</th><th className="num">มูลค่า</th><th className="num">ภาษีมูลค่าเพิ่ม</th><th /></tr></thead>
            <tbody>{shown.map(r => { const f = filing(dateIso(r.date), r.created_at); return (
              <Fragment key={r.id}>
                <tr style={r.status === 'cancelled' ? { opacity: .55 } : undefined}>
                  <td>{dateTh(r.date)}</td>
                  <td className="no"><Dot s={r.status} /><Link href={`/sales/${r.no}`}>{r.no}</Link>{r.deposit && <span className="sub"> (มัดจำ)</span>}<RelPop rel={r.rel} extra={r.status === 'cancelled' ? undefined : `ภ.พ.30 ${f.round} · ${f.status}`} /></td>
                  <td>{r.name}{r.project && <span className="sub"> · {r.project}</span>}</td><td>{r.tax_id ?? ''}</td><td>{r.branch}</td>
                  <td className="num">{money(r.sub)}</td><td className="num">{money(r.vat)}</td>
                  <td><Kebab print={`/sales/${r.no}/pdf`} download={`/sales/${r.no}/pdf?download=1`} /></td></tr>
                <tr className="ratesub"><td colSpan={4} /><td className="num">7%</td><td className="num">{money(r.sub)}</td><td colSpan={2} /></tr>
              </Fragment>); })}</tbody></table>}
      </div>
      {pages > 1 && <div className="noprint" style={{ display: 'flex', gap: 6, justifyContent: 'center', margin: 12 }}>
        {Array.from({ length: pages }, (_, i) => i + 1).map(p => <Link key={p} href={q(p)} className={`btn sm ${p === pg ? '' : 'ghost'}`}>{p}</Link>)}</div>}
    </>
  );
}
