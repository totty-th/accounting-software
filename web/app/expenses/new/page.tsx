import { requirePage } from '@/lib/auth';
import { getDb, today } from '@/lib/db';
import { ExpenseForm } from '@/components/DocForm';
import { createExpense } from '@/lib/actions';
import { partyName } from '@/lib/format';

export default async function NewExpense() {
  await requirePage('expenses.write');
  const db = await getDb();
  const vendors = (await db.q(`select id, business_name, contact_name from contacts where not is_cash_default and is_vendor order by business_name nulls last`))
    .map(c => ({ id: c.id as string, label: partyName(c) }));
  const accounts = (await db.q(`select code, name from accounts where type in ('expense','asset') and code not in ('11112','11311','11319','17111','17113','17114','17120') order by code`))
    .map(a => ({ id: a.code as string, label: `${a.code} ${a.name}` }));
  return (<><div className="top"><h1>ค่าใช้จ่ายใหม่</h1></div>
    <ExpenseForm vendors={vendors} accounts={accounts} today={today()} action={createExpense} /></>);
}
