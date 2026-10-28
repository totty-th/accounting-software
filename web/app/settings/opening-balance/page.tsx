import { requirePage } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { getDb } from '@/lib/db';
import { OpeningBalanceForm } from '@/components/OpeningBalanceForm';

export const dynamic = 'force-dynamic';
export default async function Opening() {
  const user = await requirePage('reports.read');
  const db = await getDb();
  const accs = await db.q<any>(`select code, name from accounts where type in ('asset','liability','equity') and is_active order by code`);
  const [v] = await db.q<any>(`select v.id, v.voucher_date::text d from journal_vouchers v where v.source_type='OPENING' and v.reverses_id is null and not exists (select 1 from journal_vouchers r where r.reverses_id=v.id) order by v.created_at desc limit 1`);
  const cur: Record<string, { debit: number; credit: number }> = {};
  if (v) for (const l of await db.q<any>(`select a.code, l.debit::float8 debit, l.credit::float8 credit from journal_lines l join accounts a on a.id=l.account_id where l.voucher_id=$1`, [v.id])) cur[l.code] = l;
  const rows = accs.map(a => ({ code: a.code, name: a.name, debit: cur[a.code]?.debit ? String(cur[a.code].debit) : '', credit: cur[a.code]?.credit ? String(cur[a.code].credit) : '' }));
  return (
    <>
      <div className="top"><div><h1>ตั้งค่ายอดเริ่มต้น</h1><p className="sub">ยอดยกมาของบัญชีสินทรัพย์ หนี้สิน และส่วนของผู้ถือหุ้น · ลงเป็นใบสำคัญ JV (ยอดเริ่มต้น)</p></div></div>
      {can(user.role, 'accounts.write')
        ? <OpeningBalanceForm date={v?.d ?? new Date().getFullYear() + '-01-01'} rows={rows} />
        : <div className="panel"><table><tbody>{rows.filter(r => r.debit || r.credit).map(r => <tr key={r.code}><td className="no">{r.code}</td><td>{r.name}</td><td className="num">{r.debit}</td><td className="num">{r.credit}</td></tr>)}</tbody></table></div>}
    </>
  );
}
