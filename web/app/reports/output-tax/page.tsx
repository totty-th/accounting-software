import Link from 'next/link';
import { requirePage } from '@/lib/auth';
import { getDb, today } from '@/lib/db';
import { dateTh, dateIso } from '@/lib/format';
import { periodRange } from '@/lib/period';
import { taxPeriodLabel } from '@/lib/report-filter';
import { salesTaxRows, filingInfo } from '@/lib/tax-report';
import { Dot, RelPop, Kebab } from '@/components/TaxBits';

export const dynamic = 'force-dynamic';
type Sp = { m?: string; fs?: string; show?: string; page?: string };
const PAGE = 20;
const fmt = (n: number) => { const s = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); return n < 0 ? `(${s})` : s; };

// รายงานภาษีขาย ภ.พ.30 (REA FA 29-10-2026): เลือกช่วงเวลาที่ยื่นแบบ (เดือนปัจจุบัน/เดือนก่อน) + สถานะ แล้วกด "แสดงผลรายงาน" · ยังไม่กด = หน้าว่าง และปุ่ม Excel กดไม่ได้
// แสดง CA/INV/DN เป็นบวก CN เป็นลบ (วงเล็บ) · ไม่รวมใบยกเลิก · ไม่มีแถวรวมบนหน้าจอ (มีในไฟล์ Excel)
export default async function OutputTax({ searchParams }: { searchParams: Sp }) {
  await requirePage('reports.read');
  const m = searchParams.m === 'lastmonth' ? 'lastmonth' : 'month', fs = ['wait', 'filed'].includes(searchParams.fs ?? '') ? searchParams.fs! : '';
  const shown = searchParams.show === '1';
  const range = periodRange(m, today());
  const db = await getDb();
  let rows: Awaited<ReturnType<typeof salesTaxRows>> = [], filing: Awaited<ReturnType<typeof filingInfo>> | null = null;
  const co = (await db.q<any>('select name, tax_id from company_profile'))[0];
  if (shown) {
    filing = await filingInfo(db);
    rows = (await salesTaxRows(db, range, [], false)).filter(r => !fs || (fs === 'filed') === (filing!(dateIso(r.date), r.created_at).status === 'ยื่นแบบภาษีแล้ว'));
  }
  const pages = Math.max(1, Math.ceil(rows.length / PAGE)), pg = Math.min(pages, Math.max(1, Number(searchParams.page) || 1));
  const q = (p: number) => `/reports/output-tax?m=${m}&fs=${fs}&show=1&page=${p}`;
  const xl = `/reports/sales-tax/export?mode=output&period=${m}&fs=${fs}`;
  return (
    <>
      <div className="top"><h1>รายงานภาษีขาย ภ.พ.30</h1>
        {shown ? <a className="btn" href={xl}>ดาวน์โหลดเป็น Excel</a> : <button className="btn" disabled>ดาวน์โหลดเป็น Excel</button>}</div>
      <form className="row-inline rf noprint" method="get">
        <input type="hidden" name="show" value="1" />
        <label className="f">ช่วงเวลาที่ยื่นแบบภาษี<select name="m" defaultValue={m}><option value="month">เดือนปัจจุบัน</option><option value="lastmonth">เดือนก่อน</option></select></label>
        <label className="f">สถานะ<select name="fs" defaultValue={fs}><option value="">แสดงทั้งหมด</option><option value="wait">รอยื่นแบบภาษี</option><option value="filed">ยื่นแบบภาษีแล้ว</option></select></label>
        <button className="btn" type="submit">แสดงผลรายงาน</button>
      </form>
      <div className="panel" style={{ textAlign: 'center' }}>
        <h2 style={{ margin: 0 }}>รายงานภาษีขาย ภ.พ.30</h2>
        <div>เดือนภาษี {shown ? taxPeriodLabel(range).replace('เดือน ', '') : '- ปี -'}</div>
        <div className="sub">ชื่อผู้ประกอบการ {co?.name ?? '-'} เลขประจำตัวผู้เสียภาษีอากร {co?.tax_id ?? '-'} (สำนักงานใหญ่)</div>
        <div className="sub">ชื่อสถานที่ประกอบการ</div>
      </div>
      <div className="panel" style={{ padding: 0, overflowX: 'auto' }}>
        {!shown ? <div className="empty">เลือกข้อมูลที่ต้องการค้นหา แล้วคลิกที่ &lsquo;แสดงผลรายงาน&rsquo;</div> : rows.length === 0 ? <div className="empty">ไม่มีเอกสารในช่วงที่เลือก</div> :
          <table><thead><tr><th>วันที่</th><th>เลขที่เอกสาร</th><th>ชื่อผู้จำหน่าย/เลขผู้เสียภาษี/สำนักงาน</th><th className="num">มูลค่า</th><th className="num">ภาษีมูลค่าเพิ่ม</th><th /></tr></thead>
            <tbody>{rows.slice((pg - 1) * PAGE, pg * PAGE).map(r => { const f = filing!(dateIso(r.date), r.created_at); return (
              <tr key={r.id}><td>{dateTh(r.date)}</td>
                <td className="no"><Dot s={r.status} /><Link href={`/sales/${r.no}`}>{r.no}</Link><RelPop rel={r.rel} extra={`ภ.พ.30 ${f.round} · ${f.status}`} /></td>
                <td>{r.name}{r.tax_id && <div className="sub">{r.tax_id}</div>}<div className="sub">{r.branch}</div></td>
                <td className="num">{fmt(r.sub)}</td><td className="num">{fmt(r.vat)}</td>
                <td><Kebab print={`/sales/${r.no}/pdf`} download={`/sales/${r.no}/pdf?download=1`} /></td></tr>); })}</tbody></table>}
      </div>
      {pages > 1 && <div className="noprint" style={{ display: 'flex', gap: 6, justifyContent: 'center', margin: 12 }}>
        {Array.from({ length: pages }, (_, i) => i + 1).map(p => <Link key={p} href={q(p)} className={`btn sm ${p === pg ? '' : 'ghost'}`}>{p}</Link>)}</div>}
    </>
  );
}
