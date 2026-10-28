import Link from 'next/link';
import { requirePage } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { getDb, today } from '@/lib/db';
import { money } from '@/lib/format';
import { fiscalYears } from '@/lib/fiscal';
import { ActionButton } from '@/components/ActionButton';
import { closeYear, resetYearClose } from '@/lib/actions';

export const dynamic = 'force-dynamic';
export default async function CloseYear() {
  const user = await requirePage('reports.read');
  const db = await getDb();
  const years = await fiscalYears(db, today());
  const cur = Number(today().slice(0, 4));
  const canW = can(user.role, 'accounts.write');
  const rows = [];
  for (const y of years) {
    const is = await db.q<any>('select section, amount::float8 amount from income_statement($1::date,$2::date)', [`${y}-01-01`, `${y}-12-31`]);
    const rev = is.filter(r => r.section === 'revenue').reduce((s, r) => s + r.amount, 0), exp = is.filter(r => r.section !== 'revenue').reduce((s, r) => s + r.amount, 0);
    const [c] = await db.q<any>(`select voucher_id, (select voucher_no from journal_vouchers where id=voucher_id) no from year_closes where year=$1 and status='closed'`, [y]);
    rows.push({ y, rev, exp, net: rev - exp, has: is.length > 0, c });
  }
  return (
    <>
      <div className="top"><div><h1>ปิดบัญชีสิ้นปี</h1><p className="sub">โอนรายได้และค่าใช้จ่ายของปี (1 ม.ค. – 31 ธ.ค.) เข้ากำไรสะสม ด้วยใบสำคัญ CP ลงวันที่ 31 ธ.ค. · งบกำไรขาดทุนไม่นับใบ CP · ยกเลิกได้ด้วย "รีเซ็ต" (กลับรายการ -R)</p></div></div>
      <div className="panel" style={{ padding: 0, overflowX: 'auto' }}>
        <table><thead><tr><th>ปี</th><th className="num">รายได้</th><th className="num">ค่าใช้จ่าย</th><th className="num">กำไร (ขาดทุน) สุทธิ</th><th>สถานะ</th><th /></tr></thead>
          <tbody>{rows.map(r => <tr key={r.y}><td>{r.y}</td><td className="num">{money(r.rev)}</td><td className="num">{money(r.exp)}</td><td className="num">{money(r.net)}</td>
            <td>{r.c ? <>ปิดบัญชีแล้ว · <Link href={`/journals/${r.c.voucher_id}`}>{r.c.no}</Link></> : r.y >= cur ? 'ปีปัจจุบัน — ยังไม่ปิด' : 'ยังไม่ปิด'}</td>
            <td>{canW && (r.c
              ? <ActionButton action={resetYearClose.bind(null, r.y)} label="รีเซ็ต" variant="ghost" confirmText={`รีเซ็ตการปิดบัญชีปี ${r.y}?`} />
              : r.has && <ActionButton action={closeYear.bind(null, r.y)} label="ปิดบัญชี" confirmText={`ปิดบัญชีปี ${r.y}? กำไรสุทธิ ${money(r.net)} จะโอนเข้ากำไรสะสม`} />)}</td></tr>)}</tbody></table>
      </div>
    </>
  );
}
