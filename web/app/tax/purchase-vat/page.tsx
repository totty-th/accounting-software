import Link from 'next/link';
import { requirePage } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { getDb, today } from '@/lib/db';
import { money, dateTh, dateIso } from '@/lib/format';
import { periodRange } from '@/lib/period';
import { reportPeriod } from '@/lib/report-filter';
import { purchaseTaxRows, filingInfo } from '@/lib/tax-report';
import { ReportFilter } from '@/components/ReportFilter';
import { VatTable, type VatRow } from '@/components/VatTable';
import { VAT_KEYS, VAT_CLAIM, vatKey, claimBucket } from '@/lib/vat-status';

export const dynamic = 'force-dynamic';
type Sp = { period?: string; from?: string; to?: string; st?: string | string[]; q?: string; claim?: string; rate?: string };
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
  const sts = ([] as string[]).concat(searchParams.st ?? []).filter(x => VAT_KEYS.some(k => k[0] === x));
  const view = rows.map(r => {
    const flag = flags.get(`${r.kind}:${r.id}`);
    const status = flag ?? (r.inv_no ? 'received' : 'wait');
    const is36 = status === 'received' && r.vat_form === 'PP36';
    const k = `${r.kind}:${r.id}`, x36 = f36.get(k);
    const filed = used30.has(k) || (is36 ? false : status === 'received' && !f36.has(k) && filing(dateIso(r.date), r.created_at).status === 'ยื่นแบบภาษีแล้ว');
    const stage = is36 && !filed ? (!x36 ? 'pp36' : !x36.paid ? 'f36' : x36.rd ? 'rddone' : 'rdwait') : '';
    const o = { ...r, st: status, filed, p36: stage === 'pp36', stage, rd: x36?.rd ?? '' };
    return { ...o, key: vatKey(o), claim: filed || status === 'waived' ? '' : claimBucket(dateIso(r.date), today()) };
  }).filter(r => (sts.length === 0 || sts.includes(r.key)) && (!searchParams.claim || r.claim === searchParams.claim)
    && (!searchParams.rate || (r.sub > 0 ? Math.round(r.vat / r.sub * 100) : 0) === Number(searchParams.rate))
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
        <fieldset className="f" style={{ border: 0, padding: 0 }}><legend style={{ fontSize: 12 }}>สถานะ</legend>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>{VAT_KEYS.map(([k, l, c]) => <label key={k} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <input type="checkbox" name="st" value={k} defaultChecked={sts.includes(k)} /><i style={{ width: 9, height: 9, borderRadius: 5, background: c, display: 'inline-block' }} />{l}</label>)}</div></fieldset>
        <label className="f">อัตรา VAT<select name="rate" defaultValue={searchParams.rate ?? ''}><option value="">ทั้งหมด</option><option value="7">7%</option><option value="0">0%</option></select></label>
        <label className="f">รอใช้สิทธิ์<select name="claim" defaultValue={searchParams.claim ?? ''}><option value="">ทั้งหมด</option>{VAT_CLAIM.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <button className="btn">ค้นหา</button>
        {(sts.length > 0 || searchParams.claim || searchParams.rate || q) && <Link className="btn ghost" href="/tax/purchase-vat">ล้างตัวกรอง</Link>}
      </form>
      <div className="panel" style={{ padding: 0, overflowX: 'auto' }}>
        <div style={{ padding: 10 }}>รายการทั้งหมด {view.length} รายการ</div>
        <VatTable canWrite={canW} totalTxt={money(total)} rows={view.map((r): VatRow => ({ kind: r.kind, id: r.id, href: r.href, no: r.no, dateTxt: dateTh(r.date), docDate: dateIso(r.date), inv_no: r.inv_no ?? null, name: r.name,
          baseTxt: money(r.vat_form === 'PP36' && r.inv_base != null ? r.inv_base : r.sub), vatTxt: money(r.vat_form === 'PP36' && r.inv_vat != null ? r.inv_vat : r.vat),
          st: r.st, filed: r.filed, stage: r.stage, rd: r.rd, form: r.vat_form ?? '', docTotal: r.sub + r.vat, key: r.key }))} />
      </div>
    </>
  );
}
