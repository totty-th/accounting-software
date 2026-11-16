import { getDb } from './db';
import { empName } from './payroll';
/** พนักงานที่ใช้ในฟอร์มรายการเงินเดือน (ตามประเภท ยกเว้นลาออก) */
export const empRows = async (type: string) => (await (await getDb()).q<any>(
  `select id, code, title, first_name, last_name, salary, sso, auto_tax, pay_method from employees where pay_type=$1 and status <> 'resigned' order by code`, [type]))
  .map(e => ({ id: e.id as string, code: e.code as string, name: empName(e), salary: Number(e.salary), sso: !!e.sso, auto_tax: !!e.auto_tax, pay_method: e.pay_method as string }));
