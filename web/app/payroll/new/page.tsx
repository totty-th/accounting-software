import { requirePage } from '@/lib/auth';
import { getDb, today } from '@/lib/db';
import { payrollEnabled } from '@/lib/modules';
import { PayrollOff } from '@/components/PayrollGate';
import { PayrollRunForm } from '@/components/PayrollRunForm';
import { RUN_TYPE } from '@/lib/payroll';
import { empRows } from '@/lib/payroll-server';

export const dynamic = 'force-dynamic';
export default async function NewRun({ searchParams }: { searchParams: { type?: string; method?: string } }) {
  await requirePage('payroll.write');
  if (!(await payrollEnabled())) return <PayrollOff />;
  const type = searchParams.type === 'daily' ? 'daily' : 'monthly', method = searchParams.method === 'cash' ? 'cash' : 'transfer';
  const t = today(), first = t.slice(0, 8) + '01';
  const d = new Date(first + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + 1); d.setUTCDate(0);
  const sso = (await (await getDb()).q<any>(`select sso_enabled from payroll_settings`))[0]?.sso_enabled ?? false;
  return (<><div className="top"><h1>สร้างรายการ{RUN_TYPE[type]}</h1></div>
    <PayrollRunForm id={null} payType={type} method={method} ssoOn={sso} init={null} emps={await empRows(type)}
      header={{ doc_date: t, period_from: first, period_to: d.toISOString().slice(0, 10), pay_date: t, note: '' }} /></>);
}
