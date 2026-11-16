import { notFound, redirect } from 'next/navigation';
import { requirePage } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { dateIso } from '@/lib/format';
import { payrollEnabled } from '@/lib/modules';
import { PayrollOff } from '@/components/PayrollGate';
import { PayrollRunForm } from '@/components/PayrollRunForm';
import { empRows } from '@/lib/payroll-server';

export const dynamic = 'force-dynamic';
export default async function EditRun({ params }: { params: { id: string } }) {
  await requirePage('payroll.write');
  if (!(await payrollEnabled())) return <PayrollOff />;
  if (!/^[0-9a-f-]{36}$/.test(params.id)) notFound();
  const db = await getDb();
  const r = (await db.q<any>(`select * from payroll_runs where id=$1`, [params.id]))[0];
  if (!r) notFound();
  if (r.status !== 'pending') redirect(`/payroll/${r.id}`);
  const lines = await db.q<any>(`select * from payroll_lines where run_id=$1`, [r.id]);
  const sso = (await db.q<any>(`select sso_enabled from payroll_settings`))[0]?.sso_enabled ?? false;
  const emps = await empRows(r.pay_type);
  // พนักงานในรายการที่ลาออกไปแล้วยังต้องแสดง
  const missing = lines.filter((l: any) => !emps.some(e => e.id === l.employee_id)).map((l: any) => l.employee_id);
  if (missing.length) (await db.q<any>(`select * from employees where id = any($1::uuid[])`, [missing])).forEach(e =>
    emps.push({ id: e.id, code: e.code, name: `${e.title}${e.first_name} ${e.last_name}`, salary: Number(e.salary), sso: e.sso, auto_tax: e.auto_tax, pay_method: e.pay_method }));
  return (<><div className="top"><h1>แก้ไขรายการเงินเดือน</h1></div>
    <PayrollRunForm id={r.id} payType={r.pay_type} method={r.pay_method} ssoOn={sso} init={lines} emps={emps}
      header={{ doc_date: dateIso(r.doc_date), period_from: dateIso(r.period_from), period_to: dateIso(r.period_to), pay_date: dateIso(r.pay_date), note: r.note ?? '' }} /></>);
}
