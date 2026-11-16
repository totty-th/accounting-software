import { requirePage } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { payrollEnabled } from '@/lib/modules';
import { PayrollOff } from '@/components/PayrollGate';
import { PayrollSettingsForm } from '@/components/PayrollSettingsForm';

export const dynamic = 'force-dynamic';
export default async function PayrollSettings() {
  await requirePage('payroll.write');
  if (!(await payrollEnabled())) return <PayrollOff />;
  const db = await getDb();
  const s = (await db.q<any>(`select enabled, bank_account_id, sso_enabled, sso_employer_no, sso_branch, pvd_enabled, wcf_office, wcf_phone, wcf_code, wcf_rate::text from payroll_settings`))[0];
  const banks = (await db.q<any>(`select id, bank_name, account_no from bank_accounts where is_active order by bank_name`)).map(b => ({ id: b.id, label: `${b.bank_name} ${b.account_no}` }));
  return (<><div className="top"><div><h1>ตั้งค่าเงินเดือน</h1><p className="sub">ต้องบันทึกก่อนเริ่มทำรายการเงินเดือน</p></div></div>
    <PayrollSettingsForm s={s} banks={banks} /></>);
}
