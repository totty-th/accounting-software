import Link from 'next/link';
import { requirePage } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { getDb } from '@/lib/db';
import { money } from '@/lib/format';
import { payrollEnabled } from '@/lib/modules';
import { PayrollOff } from '@/components/PayrollGate';
import { EMP_STATUS, PAY_TYPE, PAY_METHOD, empName } from '@/lib/payroll';

export const dynamic = 'force-dynamic';
export default async function Employees() {
  const u = await requirePage('payroll.read');
  if (!(await payrollEnabled())) return <PayrollOff />;
  const rows = await (await getDb()).q<any>(`select * from employees order by status = 'resigned', code`);
  return (
    <>
      <div className="top"><div><h1>รายชื่อพนักงาน</h1><p className="sub">{rows.length} คน</p></div>
        {can(u.role, 'payroll.write') && <Link className="btn" href="/payroll/employees/new">สร้างใหม่</Link>}</div>
      <div className="panel" style={{ padding: 0, overflowX: 'auto' }}>
        <table><thead><tr><th>รหัสพนักงาน</th><th>ชื่อพนักงาน/ตำแหน่ง</th><th>แผนก</th><th>ประเภท</th><th className="num">เงินเดือน/ค่าจ้าง</th><th>รับเงิน</th><th>สถานะ</th></tr></thead>
          <tbody>{rows.map(e => <tr key={e.id} data-href={`/payroll/employees/${e.id}`}>
            <td><Link href={`/payroll/employees/${e.id}`}>{e.code}</Link></td><td>{empName(e)}<div className="sub">{e.position ?? ''}</div></td>
            <td>{e.department ?? '-'}</td><td>{PAY_TYPE[e.pay_type]}</td><td className="num">{money(e.salary)}{e.pay_type === 'daily' ? '/วัน' : ''}</td>
            <td>{PAY_METHOD[e.pay_method]}</td><td><span className={`pill ${EMP_STATUS[e.status][1]}`}>{EMP_STATUS[e.status][0]}</span></td></tr>)}
            {rows.length === 0 && <tr><td colSpan={7} className="empty">ยังไม่มีพนักงาน</td></tr>}</tbody></table>
      </div>
    </>
  );
}
