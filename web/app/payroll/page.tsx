import Link from 'next/link';
import { requirePage } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { getDb } from '@/lib/db';
import { money, dateTh } from '@/lib/format';
import { payrollEnabled } from '@/lib/modules';
import { PayrollOff } from '@/components/PayrollGate';
import { RUN_STATUS, RUN_TYPE, PAY_METHOD } from '@/lib/payroll';

export const dynamic = 'force-dynamic';
export default async function Payroll({ searchParams }: { searchParams: { type?: string } }) {
  const u = await requirePage('payroll.read');
  if (!(await payrollEnabled())) return <PayrollOff />;
  const db = await getDb();
  const set = (await db.q<any>(`select sso_enabled, sso_employer_no from payroll_settings`))[0];
  const type = searchParams.type === 'monthly' || searchParams.type === 'daily' ? searchParams.type : null;
  const rows = await db.q<any>(`select r.*, coalesce(sum(l.base + l.ot + l.commission + l.sso_employer),0) cost, coalesce(sum(l.net),0) net, count(l.*) n
      from payroll_runs r left join payroll_lines l on l.run_id = r.id where ($1::text is null or r.pay_type = $1)
     group by r.id order by r.period_from desc, r.created_at desc`, [type]);
  const w = can(u.role, 'payroll.write');
  return (
    <>
      <div className="top"><div><h1>รายการเงินเดือน/ค่าจ้าง</h1><p className="sub">บันทึกแล้วลงบัญชีค้างจ่ายทันที · จ่ายแล้วลงบัญชีจ่าย</p></div>
        {w && <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {(['monthly', 'daily'] as const).flatMap(t => (['cash', 'transfer'] as const).map(m =>
            <Link key={t + m} className={`btn sm ${t === 'daily' ? 'ghost' : ''}`} href={`/payroll/new?type=${t}&method=${m}`}>+ {RUN_TYPE[t]} ({PAY_METHOD[m]})</Link>))}</div>}</div>
      {w && !set?.sso_employer_no && set?.sso_enabled === false && <p className="sub">ยังไม่ได้ตั้งค่าประกันสังคม — <Link href="/payroll/settings">ตั้งค่าเงินเดือน</Link></p>}
      <div className="tabs">{[[null, 'แสดงทั้งหมด'], ['monthly', 'เงินเดือน'], ['daily', 'ค่าจ้างรายวัน']].map(([k, l]) =>
        <a key={l} className={type === k ? 'on' : ''} href={k ? `/payroll?type=${k}` : '/payroll'}>{l}</a>)}</div>
      <div className="panel" style={{ padding: 0, overflowX: 'auto' }}>
        <table><thead><tr><th>ช่วงวันที่</th><th>ประเภท</th><th>วันที่ชำระ</th><th className="num">พนักงาน</th><th className="num">ค่าใช้จ่ายพนักงานรวม</th><th className="num">ยอดจ่ายรวมสุทธิ</th><th>สถานะ</th></tr></thead>
          <tbody>{rows.map(r => <tr key={r.id} data-href={`/payroll/${r.id}`}>
            <td><Link href={`/payroll/${r.id}`}>{dateTh(r.period_from)} – {dateTh(r.period_to)}</Link></td><td>{RUN_TYPE[r.pay_type]}</td>
            <td>{dateTh(r.paid_date ?? r.pay_date)}</td><td className="num">{r.n}</td><td className="num">{money(r.cost)}</td>
            <td className="num">{money(r.net)}<div className="sub">{PAY_METHOD[r.pay_method]}</div></td>
            <td><span className={`pill ${RUN_STATUS[r.status][1]}`}>{RUN_STATUS[r.status][0]}</span></td></tr>)}
            {rows.length === 0 && <tr><td colSpan={7} className="empty">ยังไม่มีรายการเงินเดือน</td></tr>}</tbody></table>
      </div>
    </>
  );
}
