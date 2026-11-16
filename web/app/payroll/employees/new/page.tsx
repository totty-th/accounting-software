import { requirePage } from '@/lib/auth';
import { today } from '@/lib/db';
import { payrollEnabled } from '@/lib/modules';
import { PayrollOff } from '@/components/PayrollGate';
import { EmployeeForm } from '@/components/EmployeeForm';

export const dynamic = 'force-dynamic';
export default async function NewEmployee() {
  await requirePage('payroll.write');
  if (!(await payrollEnabled())) return <PayrollOff />;
  return (<><div className="top"><h1>สร้างรายชื่อพนักงาน</h1></div><EmployeeForm id={null} init={null} today={today()} /></>);
}
