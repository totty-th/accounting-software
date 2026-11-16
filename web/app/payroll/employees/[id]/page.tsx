import { notFound } from 'next/navigation';
import { requirePage } from '@/lib/auth';
import { getDb, today } from '@/lib/db';
import { dateIso } from '@/lib/format';
import { payrollEnabled } from '@/lib/modules';
import { PayrollOff } from '@/components/PayrollGate';
import { EmployeeForm } from '@/components/EmployeeForm';
import { empName } from '@/lib/payroll';

export const dynamic = 'force-dynamic';
export default async function EditEmployee({ params }: { params: { id: string } }) {
  await requirePage('payroll.write');
  if (!(await payrollEnabled())) return <PayrollOff />;
  if (!/^[0-9a-f-]{36}$/.test(params.id)) notFound();
  const e = (await (await getDb()).q<any>(`select * from employees where id=$1`, [params.id]))[0];
  if (!e) notFound();
  const init = Object.fromEntries(Object.entries(e).map(([k, v]) => [k, v instanceof Date ? dateIso(v) : k === 'salary' ? String(Number(v)) : v ?? '']));
  return (<><div className="top"><h1>{empName(e)} <span className="sub">{e.code}</span></h1></div><EmployeeForm id={e.id} init={init} today={today()} /></>);
}
