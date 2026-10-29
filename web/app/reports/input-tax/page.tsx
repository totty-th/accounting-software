import Link from 'next/link';
import { requirePage } from '@/lib/auth';
import { getDb, today } from '@/lib/db';
import { dateTh } from '@/lib/format';
import { periodRange } from '@/lib/period';
import { taxPeriodLabel } from '@/lib/report-filter';
import { inputTaxPp30Rows } from '@/lib/tax-report';
import { RelPop } from '@/components/TaxBits';

export const dynamic = 'force-dynamic';
type Sp = { m?: string; fs?: string; show?: string; rd?: string; page?: string };
const PAGE = 20;
const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// รายงานภาษีซื้อ ภ.พ.30 (REA FA 29-10-2026): กด "แสดงผลรายงาน" จึงแสดงข้อมูล · ปุ่ม Excel กดไม่ได้จนกว่าจะแสดงรายงาน · แถวละ 20 · ไม่มีแถวรวมบนจอ (มีใน Excel)
export default async function Page({ searchParams }: { searchParams: Sp }) {
  await requirePage('reports.read');
  const m = searchParams.m === 'lastmonth' ? 'lastmonth' : 'month', fs = ['wait', 'filed'].includes(searchParams.fs ?? '') ? searchParams.fs! : '';
  const shown = searchParams.show === '1',  rd = shown ? searchParams.rd === '1' : true;
  const range = periodRange(m, today());
  const db = await getDb();
  const co = (await db.q<any>('select name, tax_id from company_profile'))[0];
  const rows = shown ? await inputTaxPp30Rows(db, range, fs, rd) : [];
  const pages = Math.max(1, Math.ceil(rows.length / PAGE)), pg = Math.min(pages, Math.max(1, Number(searchParams.page) || 1));
  const q = (p: number) => `/reports/input-tax?m=${m}&fs=${fs}&rd=${rd ? 1 : 0}&show=1&page=${p}`;
  const xl = `/reports/input-tax/export?period=${m}&fs=${fs}&rd=${rd ? 1 : 0}`;
  return (
    <>
      <div className="top"><h1>รายงานภาษีซื้อ ภ.พ.30</h1>
        {shown ? <a className="btn" href={xl}>ดาวน์โหลดเป็น Excel</a> : <button className="btn" disabled>ดาวน์โหลดเป็น Excel</button>}</div>
      <form className="row-inline rf noprint" method="get">
        <input type="hidden" name="show" value="1" />
        <label className="f">ช่วงเวลาที่ยื่นแบบภาษี<select name="m" defaultValue={m}><option value="month">เดือนปัจจุบัน</option><option value="lastmonth">เดือนก่อน</option></select></label>
        <label className="f">สถานะ<select name="fs" defaultValue={fs}><option value="">แสดงทั้งหมด</option><option value="wait">รอยื่นแบบภาษี</option><option value="filed">ยื่นแบบภาษีแล้ว</option></select></label>
        <label className="f">แสดงข้อมูล<span><input type="checkbox" name="rd" value="1" defaultChecked={rd} /> ข้อมูลใบเสร็จสรรพากร ภ.พ.36</span></label>
        <button className="btn" type="submit">แสดงผลรายงาน</button>
      </form>
      <div className="panel" style={{ textAlign: 'center' }}>
        <h2 style={{ margin: 0 }}>รายงานภาษีซื้อ ภ.พ.30</h2>
        <div>เดือนภาษี {shown ? taxPeriodLabel(range).replace('เดือน ', '') : '- ปี -'}</div>
        <div className="sub">ชื่อผู้ประกอบการ {co?.name ?? '-'} เลขประจำตัวผู้เสียภาษีอากร {co?.tax_id ?? '-'} (สำนักงานใหญ่)</div>
        <div className="sub">ชื่อสถานที่ประกอบการ</div>
      </div>
      <div className="panel" style={{ padding: 0, overflowX: 'auto' }}>
        {!shown ? <div className="empty">เลือกข้อมูลที่ต้องการค้นหา แล้วคลิกที่ &lsquo;แสดงผลรายงาน&rsquo;</div> : rows.length === 0 ? <div className="empty">ไม่มีเอกสารในช่วงที่เลือก</div> :
          <table><thead><tr><th>วันที่ใบกำกับภาษี</th><th>เลขที่ใบกำกับภาษี</th><th>ชื่อผู้จำหน่าย/เลขผู้เสียภาษี/สำนักงาน</th><th className="num">มูลค่า</th><th className="num">ภาษีมูลค่าเพิ่ม</th></tr></thead>
            <tbody>{rows.slice((pg - 1) * PAGE, pg * PAGE).map((r, i) => (
              <tr key={i}><td>{dateTh(r.date)}</td>
                <td className="no"><span className={`dot dot-${r.filed ? 'green' : 'grey'}`} title={r.status} />{r.doc_href ? <Link href={r.doc_href}>{r.no}</Link> : r.no}<RelPop rel={[]} extra={`${r.status}${r.round ? ' · ' + r.round : ''}${r.doc_no ? ' · ' + r.doc_no : ''}`} /></td>
                <td>{r.name}{r.tax_id && <div className="sub">{r.tax_id}</div>}{r.branch && <div className="sub">{r.branch}</div>}</td>
                <td className="num">{fmt(r.base)}</td><td className="num">{fmt(r.vat)}</td></tr>))}</tbody></table>}
      </div>
      {pages > 1 && <div className="noprint" style={{ display: 'flex', gap: 6, justifyContent: 'center', margin: 12 }}>
        {Array.from({ length: pages }, (_, i) => i + 1).map(p => <Link key={p} href={q(p)} className={`btn sm ${p === pg ? '' : 'ghost'}`}>{p}</Link>)}</div>}
    </>
  );
}
