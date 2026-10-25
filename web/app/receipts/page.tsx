import { can } from '@/lib/permissions';
import { requirePage } from '@/lib/auth';
import Link from 'next/link';
import { ClickRow } from '@/components/ClickRow';
import { getDb } from '@/lib/db';
import { money, dateTh, partyName } from '@/lib/format';
import { Pill } from '@/components/Pill';
import { Group } from '@/components/Board';
import { ActionButton } from '@/components/ActionButton';
import { RECEIPT_KIND } from '@/lib/status';
import * as A from '@/lib/actions';
import { related } from '@/lib/related';
import { RelPop } from '@/components/TaxBits';

export default async function Receipts() {
  const user = await requirePage('receipts.read');
  const W = can(user.role, 'receipts.write');
  const db = await getDb();
  const rows = await db.q(`select r.*, c.business_name, c.contact_name from receipts r join contacts c on c.id=r.contact_id order by r.receipt_date desc, r.receipt_no desc`);
  const relMap = await related(db, 'receipt', rows.map(r => r.id));
  const sets: [string, string, string][] = [['pending', 'รอเก็บเงิน', 'var(--orange)'], ['collected', 'เก็บเงินแล้ว', 'var(--green)'], ['cancelled', 'ยกเลิก', 'var(--grey)']];
  return (
    <>
      <div className="top"><div><h1>ใบเสร็จและการรับเงิน</h1><p className="sub">สร้างใบเสร็จจากหน้าเอกสารขาย (ปุ่ม “สร้างใบเสร็จ” ที่ใบแจ้งหนี้)</p></div></div>
      {rows.length === 0 && <div className="panel empty">ยังไม่มีใบเสร็จ</div>}
      {sets.map(([s, title, color]) => {
        const rs = rows.filter(r => r.status === s); if (!rs.length) return null;
        return (
          <Group key={s} title={title} color={color} count={rs.length}>
            <table><thead><tr><th>เลขที่</th><th>ประเภท</th><th>ลูกค้า</th><th>วันที่</th><th className="num">ยอดรับ</th><th className="num">หัก ณ ที่จ่าย</th><th>สถานะ</th><th /></tr></thead>
              <tbody>{rs.map(r => (
                <ClickRow key={r.id} href={`/receipts/${r.receipt_no}`}><td className="no"><Link href={`/receipts/${r.receipt_no}`}>{r.receipt_no}</Link><RelPop rel={relMap.get(r.id) ?? []} /></td><td>{RECEIPT_KIND[r.kind]}</td><td>{partyName(r)}</td><td>{dateTh(r.receipt_date)}</td>
                  <td className="num">{money(r.amount)}</td><td className="num">{Number(r.wht) ? money(r.wht) : '-'}</td><td><Pill s={r.status} /></td>
                  <td><div className="acts">
                    {W && r.status === 'pending' && <ActionButton label="เก็บเงิน" action={A.collectReceipt.bind(null, r.id)} />}
                    {W && r.status === 'collected' && <ActionButton label="รีเซ็ต" variant="ghost" action={A.resetReceipt.bind(null, r.id)} />}
                    {W && r.status !== 'cancelled' && <ActionButton label="ยกเลิก" variant="danger" confirmText="c" action={A.cancelReceipt.bind(null, r.id)} />}
                  </div></td></ClickRow>))}</tbody></table>
          </Group>);
      })}
    </>
  );
}
