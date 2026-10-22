import { getDb } from '@/lib/db';
import { Group } from '@/components/Board';
import { QuickAdd } from '@/components/QuickAdd';
import { createContact } from '@/lib/actions';

export default async function Contacts() {
  const rows = await (await getDb()).q(`select * from contacts order by is_cash_default, business_name nulls last, contact_name`);
  return (
    <>
      <div className="top"><div><h1>ลูกค้า / ผู้ขาย</h1><p className="sub">ใช้ร่วมกันทั้งฝั่งขายและฝั่งซื้อ</p></div>
        <QuickAdd label="เพิ่มรายชื่อ" action={createContact} fields={[
          { name: 'business_name', label: 'ชื่อธุรกิจ' }, { name: 'contact_name', label: 'ชื่อผู้ติดต่อ' }, { name: 'tax_id', label: 'เลขผู้เสียภาษี (10 หรือ 13 หลัก)' }]} /></div>
      <Group title="รายชื่อทั้งหมด" color="var(--grey)" count={rows.length}>
        <table><thead><tr><th>ชื่อธุรกิจ</th><th>ผู้ติดต่อ</th><th>เลขผู้เสียภาษี</th></tr></thead>
          <tbody>{rows.map(r => <tr key={r.id}><td className="no">{r.business_name ?? '-'}</td><td>{r.contact_name ?? '-'}</td><td>{r.tax_id ?? '-'}</td></tr>)}</tbody></table>
      </Group>
    </>
  );
}
