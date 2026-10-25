import Link from 'next/link';
import { requirePage } from '@/lib/auth';
import { getDb, today } from '@/lib/db';
import { money, dateTh, dateIso } from '@/lib/format';
import { periodRange } from '@/lib/period';
import { reportPeriod, pickStatuses, PURCHASE_BUCKETS, periodLabel, pgArr } from '@/lib/report-filter';
import { purchaseTaxRows, filingInfo } from '@/lib/tax-report';
import { ReportFilter } from '@/components/ReportFilter';
import { ReportTools } from '@/components/ReportTools';
import { Dot, RelPop, Kebab } from '@/components/TaxBits';

export const dynamic = 'force-dynamic';
type Sp = { view?: string; period?: string; from?: string; to?: string; st?: string | string[]; page?: string };
const ST_OPTS: [string, string][] = [['pend', 'รอดำเนินการ / รออนุมัติ'], ['appr', 'อนุมัติ'], ['paid', 'ชำระเงินแล้ว'], ['cancelled', 'ยกเลิก / ไม่อนุมัติ']];
const PAGE = 30;

// ภาษีซื้อ 2 มุมมอง: (1) ตามเอกสาร RI/EXP ที่มี VAT (แบบ FA "ภาษีซื้อตามเอกสาร")  (2) ตามใบกำกับภาษีที่ได้รับ แยก ภ.พ.30 / ภ.พ.36
export default async function PurchaseTax({ searchParams }: { searchParams: Sp }) {
  await requirePage('reports.read');
  const view = searchParams.view === 'inv' ? 'inv' : 'doc';
  const period = reportPeriod(searchParams.period);
  const { sel, list } = pickStatuses(searchParams.st, PURCHASE_BUCKETS);
  const range = periodRange(period, today(), searchParams.from, searchParams.to);
  const db = await getDb();
  const co = (await db.q<any>('select name, tax_id from company_profile'))[0];
  const qs = (o: Record<string, string>) => { const u = new URLSearchParams(); for (const k of ['period', 'from', 'to'] as const) if (searchParams[k]) u.set(k, searchParams[k]!); sel.forEach(s => u.append('st', s)); Object.entries(o).forEach(([k, v]) => u.set(k, v)); return u.toString(); };
  const head = (
    <>
      <div className="top"><div><h1>รายงานภาษีซื้อ</h1><p className="sub">{view === 'doc' ? 'ตามเอกสารใบรับสินค้า/ค่าใช้จ่ายที่มี VAT · ใบที่ยกเลิก/ไม่อนุมัติแสดงแต่ไม่นับในยอดรวม' : 'จากข้อมูลใบกำกับภาษีที่บันทึกในค่าใช้จ่ายและใบรับสินค้า · แยก ภ.พ.30 / ภ.พ.36 (ภ.พ.36 ยังไม่ลงบัญชี)'}</p></div></div>
      <div className="tabs noprint"><Link href={`/reports/purchase-tax?${qs({ view: 'doc' })}`} className={view === 'doc' ? 'on' : ''}>ภาษีซื้อตามเอกสาร</Link>
        <Link href={`/reports/purchase-tax?${qs({ view: 'inv' })}`} className={view === 'inv' ? 'on' : ''}>ตามใบกำกับภาษี (ภ.พ.30 / ภ.พ.36)</Link></div>
      <ReportFilter period={period} from={searchParams.from} to={searchParams.to} groups={view === 'doc' ? [{ label: '', options: ST_OPTS }] : undefined} selected={sel} hidden={{ view }} />
    </>
  );
  if (view === 'inv') {
    const r = range ?? [today().slice(0, 7) + '-01', today()];
    const rows = await db.q<any>(`select * from purchase_tax_invoice_report($1::date,$2::date)`, [range?.[0] ?? '1900-01-01', range?.[1] ?? '2999-12-31']);
    const sum = (f: string) => rows.filter(x => x.vat_form === f).reduce((a, x) => ({ b: a.b + Number(x.base_amount), v: a.v + Number(x.vat_amount) }), { b: 0, v: 0 });
    void r;
    return (
      <>{head}
        <ReportTools exportBase="/reports/purchase-tax/export" modes={[['pp30', 'Excel (ภาษีซื้อ ภ.พ.30)'], ['pp36', 'Excel (ภาษีซื้อ ภ.พ.36)']]} title="รายงานภาษีซื้อตามใบกำกับ" />
        <div data-report className="panel" style={{ padding: 0, overflowX: 'auto' }}>
          {rows.length === 0 ? <div className="empty">ไม่มีใบกำกับภาษีในช่วงนี้</div> :
            <table><thead><tr><th>วันที่</th><th>เลขที่ใบกำกับ</th><th>ผู้จำหน่าย</th><th>เลขผู้เสียภาษี</th><th>สาขา</th><th>แบบ</th><th>เอกสาร</th><th className="num">มูลค่า</th><th className="num">VAT</th></tr></thead>
              <tbody>{rows.map(x => (
                <tr key={`${x.doc_type}${x.doc_no}`}><td>{dateTh(x.invoice_date)}</td><td className="no">{x.invoice_no}</td><td>{x.vendor_name}</td><td>{x.vendor_tax_id ?? '-'}</td>
                  <td>{x.branch ?? '-'}</td><td>{x.vat_form === 'PP36' ? 'ภ.พ.36' : 'ภ.พ.30'}</td><td className="no">{x.doc_no}</td>
                  <td className="num">{money(x.base_amount)}</td><td className="num">{money(x.vat_amount)}</td></tr>))}
                {(['PP30', 'PP36'] as const).map(f => <tr key={f} style={{ fontWeight: 700 }}><td colSpan={7}>รวม {f === 'PP30' ? 'ภ.พ.30' : 'ภ.พ.36'}</td>
                  <td className="num">{money(sum(f).b)}</td><td className="num">{money(sum(f).v)}</td></tr>)}</tbody></table>}
        </div></>
    );
  }
  const rows = await purchaseTaxRows(db, range, list, sel.length === 0 || list.includes('cancelled'));
  const filing = await filingInfo(db);
  const live = rows.filter(r => r.status !== 'cancelled' && r.status !== 'rejected');
  const t = live.reduce((a, r) => ({ sub: a.sub + r.sub, vat: a.vat + r.vat }), { sub: 0, vat: 0 });
  const pages = Math.max(1, Math.ceil(rows.length / PAGE)), pg = Math.min(pages, Math.max(1, Number(searchParams.page) || 1));
  const shown = rows.slice((pg - 1) * PAGE, pg * PAGE);
  void pgArr;
  return (
    <>{head}
      <ReportTools exportBase="/reports/purchase-tax/export" modes={[['doc', 'Excel (ภาษีซื้อตามเอกสาร)'], ['inputtax', 'Excel (ภาษีซื้อ ภ.พ.30)'], ['pp36', 'Excel (ภาษีซื้อ ภ.พ.36)']]} title="รายงานภาษีซื้อตามเอกสาร" />
      <div className="panel"><div className="taxhead"><div>
        <div className="sub">เดือนภาษี/ช่วงเวลา: <b>{periodLabel(range)}</b></div>
        <div className="sub">ชื่อผู้ประกอบการ {co?.name ?? '-'} · เลขประจำตัวผู้เสียภาษี {co?.tax_id ?? '-'} (สำนักงานใหญ่)</div></div>
        <div className="taxsum"><div className="sub">มูลค่า<b>{money(t.sub)}</b></div><div className="sub">ภาษีมูลค่าเพิ่ม<b>{money(t.vat)}</b></div></div></div></div>
      <div data-report className="panel" style={{ padding: 0, overflowX: 'auto', marginTop: 4 }}>
        {rows.length === 0 ? <div className="empty">ไม่มีเอกสารในช่วงที่เลือก</div> :
          <table><thead><tr><th>วันที่</th><th>เลขที่เอกสาร</th><th>เอกสารอ้างอิง</th><th>ชื่อผู้จำหน่าย/ชื่อโปรเจ็ค</th><th>เลขผู้เสียภาษี</th><th className="num">มูลค่า</th><th className="num">ภาษีมูลค่าเพิ่ม</th><th /></tr></thead>
            <tbody>{shown.map(r => { const dead = r.status === 'cancelled' || r.status === 'rejected'; const f = filing(dateIso(r.date), r.created_at); return (
              <tr key={r.id} style={dead ? { opacity: .55 } : undefined}>
                <td>{dateTh(r.date)}</td>
                <td className="no"><Dot s={r.status} /><Link href={r.href}>{r.no}</Link><RelPop rel={r.rel} extra={dead ? undefined : `${r.vat_form === 'PP36' ? 'ภ.พ.36' : 'ภ.พ.30'} เดือน ${f.round} · ${f.status}${r.inv_no ? ` · ใบกำกับ ${r.inv_no}` : ''}`} /></td>
                <td className="no">{r.ref_no ?? ''}</td><td>{r.name}</td><td>{r.tax_id ?? ''}</td>
                <td className="num">{money(r.sub)}</td><td className="num">{money(r.vat)}</td>
                <td><Kebab print={r.kind === 'RI' ? `/purchases/ri/${r.id}/pdf` : undefined} download={r.kind === 'RI' ? `/purchases/ri/${r.id}/pdf?download=1` : undefined} /></td></tr>); })}</tbody></table>}
      </div>
      {pages > 1 && <div className="noprint" style={{ display: 'flex', gap: 6, justifyContent: 'center', margin: 12 }}>
        {Array.from({ length: pages }, (_, i) => i + 1).map(p => <Link key={p} href={`/reports/purchase-tax?${qs({ view: 'doc', page: String(p) })}`} className={`btn sm ${p === pg ? '' : 'ghost'}`}>{p}</Link>)}</div>}
    </>
  );
}
