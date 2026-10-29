import Link from 'next/link';
import { requirePage } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { getDb, today } from '@/lib/db';
import { money, dateTh, dateIso } from '@/lib/format';
import { periodRange } from '@/lib/period';
import { reportPeriod } from '@/lib/report-filter';
import { purchaseTaxRows, filingInfo } from '@/lib/tax-report';
import { ReportFilter } from '@/components/ReportFilter';
import { VatStatusCell } from '@/components/VatStatusCell';
import { VAT_STATUS } from '@/lib/vat-status';

export const dynamic = 'force-dynamic';
type Sp = { period?: string; from?: string; to?: string; st?: string; q?: string };
export default async function PurchaseVat({ searchParams }: { searchParams: Sp }) {
  const user = await requirePage('reports.read');
  const period = reportPeriod(searchParams.period);
  const range = periodRange(period, today(), searchParams.from, searchParams.to);
  const db = await getDb();
  const rows = await purchaseTaxRows(db, range, [], false);
  const flags = new Map((await db.q<any>('select doc_type, doc_id, flag from purchase_vat_flags')).map(f => [`${f.doc_type}:${f.doc_id}`, f.flag as string]));
  const filing = await filingInfo(db);
  const f36 = new Map((await db.q<any>(`select d.doc_type, d.doc_id, d.rd_receipt_no rd, (p.pv_voucher_id is not null) paid from pp36_filing_docs d join pp36_filings p on p.id=d.filing_id`)).map(x => [`${x.doc_type}:${x.doc_id}`, x as { rd: string | null; paid: boolean }]));
  const used30 = new Set((await db.q<any>('select doc_type, doc_id from pp30_filing_docs')).map(x => `${x.doc_type}:${x.doc_id}`));
  const q = (searchParams.q ?? '').trim().toLowerCase();
  const view = rows.map(r => {
    const flag = flags.get(`${r.kind}:${r.id}`);
    const status = flag ?? (r.inv_no ? 'received' : 'wait');
    const is36 = status === 'received' && r.vat_form === 'PP36';
    const k = `${r.kind}:${r.id}`, x36 = f36.get(k);
    const filed = used30.has(k) || (is36 ? false : status === 'received' && !f36.has(k) && filing(dateIso(r.date), r.created_at).status === 'ยื่นแบบภาษีแล้ว');
    const stage = is36 && !filed ? (!x36 ? 'pp36' : !x36.paid ? 'f36' : x36.rd ? 'rddone' : 'rdwait') : '';
    return { ...r, st: status, filed, p36: stage === 'pp36', stage, rd: x36?.rd ?? '' };
  }).filter(r => (!searchParams.st || (searchParams.st === 'filed' ? r.filed : searchParams.st === 'pp36' ? r.p36 : r.st === searchParams.st && !r.filed && !r.p36))
    && (!q || [r.no, r.name, r.inv_no ?? '', r.tax_id ?? ''].some(s => s.toLowerCase().includes(q))));
  const total = view.reduce((s, r) => s + (r.vat_form === 'PP36' && r.inv_vat != null ? Number(r.inv_vat) : r.vat), 0), canW = can(user.role, 'accounts.write');
  return (
    <>
      <div className="top"><div><h1>จัดการเอกสารภาษีซื้อ</h1><p className="sub">ใบรับสินค้า/ค่าใช้จ่ายที่มี VAT · ติดตามสถานะใบกำกับภาษี (ไม่ลงบัญชี) · รายงานเต็มที่ <Link href="/reports/purchase-tax">รายงานภาษีซื้อ</Link></p></div></div>
      <ReportFilter period={period} from={searchParams.from} to={searchParams.to} groups={undefined} selected={[]} hidden={{}} />
      <form className="row-inline" method="get">
        {searchParams.period && <input type="hidden" name="period" value={searchParams.period} />}
        {searchParams.from && <input type="hidden" name="from" value={searchParams.from} />}{searchParams.to && <input type="hidden" name="to" value={searchParams.to} />}
        <label className="f">ค้นหา<input name="q" defaultValue={searchParams.q ?? ''} placeholder="เลขที่เอกสาร, ผู้จำหน่าย, เลขใบกำกับ" /></label>
        <label className="f">สถานะ<select name="st" defaultValue={searchParams.st ?? ''}><option value="">ทั้งหมด</option>{VAT_STATUS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}<option value="pp36">รอยื่น ภ.พ.36</option><option value="filed">ยื่นแบบแล้ว</option></select></label>
        <button className="btn">ค้นหา</button>
      </form>
      <div className="panel" style={{ padding: 0, overflowX: 'auto' }}>
        <div style={{ padding: 10 }}>รายการทั้งหมด {view.length} รายการ</div>
        <table><thead><tr><th>วันที่เอกสาร</th><th>เลขที่เอกสาร</th><th>ผู้จำหน่าย</th><th className="num">มูลค่า</th><th className="num">ภาษีมูลค่าเพิ่ม</th><th>สถานะใบกำกับภาษี</th></tr></thead>
          <tbody>{view.map(r => <tr key={`${r.kind}${r.id}`}>
            <td>{dateTh(r.date)}</td><td className="no"><Link href={r.href}>{r.no}</Link>{r.inv_no && <div className="sub">{r.inv_no}</div>}</td><td>{r.name}</td>
            <td className="num">{money(r.vat_form === 'PP36' && r.inv_base != null ? r.inv_base : r.sub)}</td><td className="num">{money(r.vat_form === 'PP36' && r.inv_vat != null ? r.inv_vat : r.vat)}</td>
            <td><VatStatusCell type={r.kind} id={r.id} status={r.st} filed={r.filed} stage={r.stage} rd={r.rd} form={r.vat_form ?? ''} invNo={r.inv_no ?? ''} docDate={dateIso(r.date)} docTotal={r.sub + r.vat} canWrite={canW} /></td></tr>)}
            {view.length === 0 && <tr><td colSpan={6} className="empty">ไม่พบเอกสาร</td></tr>}
            <tr style={{ fontWeight: 700 }}><td colSpan={4}>ยอดรวมภาษีซื้อทั้งหมด</td><td className="num">{money(total)}</td><td /></tr></tbody></table>
      </div>
    </>
  );
}
