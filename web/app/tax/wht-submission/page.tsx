import Link from 'next/link';
import { requirePage } from '@/lib/auth';
import { getDb, today } from '@/lib/db';
import { money, dateTh } from '@/lib/format';
import { whtRows } from '@/lib/tax-report';
import { ReportTools } from '@/components/ReportTools';
import { Kebab } from '@/components/TaxBits';

export const dynamic = 'force-dynamic';
const FORMS: [string, string][] = [['PND3', 'ภงด 3'], ['PND53', 'ภงด 53']];
const lastDay = (ym: string) => new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).getUTCDate();

// รายการสำหรับยื่นภาษีหัก ณ ที่จ่าย (แบบ FA "ยื่นหัก ณ ที่จ่ายออนไลน์"): เลือกแบบ ภงด 3 / 53 + เดือนภาษี → รายการหนังสือรับรองที่ใช้งานอยู่ของเดือนนั้น
// ไฟล์สำหรับอัปโหลดกรมสรรพากรยังไม่ทำ (รูปแบบไฟล์ยังไม่ยืนยัน)
export default async function WhtSubmission({ searchParams }: { searchParams: { form?: string; month?: string } }) {
  await requirePage('reports.read');
  const form = FORMS.some(f => f[0] === searchParams.form) ? searchParams.form! : 'PND3';
  const month = /^\d{4}-\d{2}$/.test(searchParams.month ?? '') ? searchParams.month! : today().slice(0, 7);
  const db = await getDb();
  const from = `${month}-01`, to = `${month}-${String(lastDay(month)).padStart(2, '0')}`;
  const rows = (await whtRows(db, [from, to], ['active'])).filter(r => (r as any).form_code === form);
  const tb = rows.reduce((a, r) => a + r.base, 0), tw = rows.reduce((a, r) => a + r.wht, 0);
  const co = (await db.q<any>('select name from company_profile'))[0];
  return (
    <>
      <div className="top"><div><h1>แบบยื่นภาษีหัก ณ ที่จ่ายออนไลน์</h1><p className="sub">รายการหนังสือรับรองหัก ณ ที่จ่ายของเดือนภาษี แยกตามแบบ ภงด 3 / ภงด 53 · ดูรายงานเต็มที่ <Link href="/reports/wht">รายงานภาษีหัก ณ ที่จ่าย</Link></p></div></div>
      <form className="row-inline" method="get">
        <label className="f">แบบยื่นภาษี<select name="form" defaultValue={form}>{FORMS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className="f">เดือนภาษี<input type="month" name="month" defaultValue={month} /></label>
        <button className="btn">แสดงผลรายงาน</button>
      </form>
      <ReportTools title="รายการสำหรับยื่นภาษีหัก ณ ที่จ่าย" meta={[['แบบ', FORMS.find(f => f[0] === form)![1]], ['เดือนภาษี', month]]} />
      <div className="panel"><div className="taxhead"><div>
        <h2 style={{ margin: 0 }}>{co?.name ?? ''}</h2>
        <div className="sub">ช่วงเวลา {dateTh(from)} - {dateTh(to)}</div>
        <div className="sub">เลขที่ {rows.length ? `${rows[0].no} - ${rows[rows.length - 1].no}` : '-'}</div></div>
        <div className="taxsum"><div className="sub">มูลค่ารวม<b>{money(tb)}</b></div><div className="sub">หัก ณ ที่จ่ายรวม<b>{money(tw)}</b></div></div></div></div>
      <div data-report className="panel" style={{ padding: 0, overflowX: 'auto', marginTop: 4 }}>
        {rows.length === 0 ? <div className="empty">ไม่มีรายการหัก ณ ที่จ่ายในเดือนที่เลือก</div> :
          <table><thead><tr><th>วันที่</th><th>เลขที่เอกสาร</th><th>ชื่อผู้ถูกหัก ณ ที่จ่าย</th><th>เลขผู้เสียภาษี</th><th>แบบฟอร์ม</th><th className="num">มูลค่า</th><th className="num">ภาษีที่หัก</th><th /></tr></thead>
            <tbody>{rows.map(r => <tr key={r.id}><td>{dateTh(r.date)}</td><td className="no">{r.no}</td><td>{r.name}</td><td>{(r as any).tax_id ?? '-'}</td><td>{r.form}</td>
              <td className="num">{money(r.base)}</td><td className="num">{money(r.wht)}</td><td><Kebab print={`/wht/${r.id}/pdf`} download={`/wht/${r.id}/pdf?download=1`} /></td></tr>)}</tbody></table>}
      </div>
    </>
  );
}
