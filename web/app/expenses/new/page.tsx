import { can } from '@/lib/permissions';
import { requirePage } from '@/lib/auth';
import { today } from '@/lib/db';
import { getDb } from '@/lib/db';
import { poFormData } from '@/lib/po-data';
import { ExpForm } from '@/components/ExpForm';

export default async function NewExpense() {
  const user = await requirePage('expenses.write');
  const { vendors } = await poFormData();
  const db = await getDb();
  const accounts = (await db.q(`select code, name from accounts where type in ('expense','asset') and code not in ('11112','11311','11319','17111','17113','17114','17120') order by code`))
    .map(a => ({ id: a.code as string, label: `${a.code} ${a.name}` }));
  return (<>
    <div className="top"><div><h1>สร้างค่าใช้จ่าย</h1><p className="sub">บันทึกแล้วตั้งเจ้าหนี้ทันที · จ่ายเงินที่หน้าเอกสาร</p></div></div>
    <ExpForm vendors={vendors} accounts={accounts} today={today()} purchaser={user.displayName || user.username} canCreateVendor={can(user.role, 'contact.create')} />
  </>);
}
