import Link from 'next/link';
import { requirePage } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { getDb, today } from '@/lib/db';
import { money } from '@/lib/format';
import { ActionButton } from '@/components/ActionButton';
import { Pp30Create, Pp30Pay } from '@/components/Pp30Forms';
import { deletePp30, resetPp30Payment, setPp30Refund } from '@/lib/actions';

export const dynamic = 'force-dynamic';
export default async function Filings() {
  const user = await requirePage('reports.read');
  const db = await getDb();
  const rows = await db.q<any>(`select id, to_char(period_month,'MM-YYYY') m, period_month::text pm, output_vat::float8 o, input_vat::float8 i, result, amount::float8 amt,
      paid_date::text paid, pv_voucher_id, refund_recorded from pp30_filings where status='filed' order by period_month desc`);
  const banks = await db.q<any>(`select code, name from accounts where type='asset' and code like '111%' and is_active order by code`);
  const canW = can(user.role, 'accounts.write');
  const prev = new Date(today() + 'T00:00:00Z'); prev.setUTCMonth(prev.getUTCMonth() - 1);
  const status = (r: any) => r.result === 'payable' ? (r.paid ? `ชำระภาษีแล้ว ${r.paid}` : 'รอชำระภาษี') : r.result === 'refund' ? (r.refund_recorded ? 'บันทึกขอคืนแล้ว' : 'รอขอคืน') : 'ไม่มียอดชำระ';
  return (
    <>
      <div className="top"><div><h1>เตรียมแบบภาษีรายเดือน</h1><p className="sub">แบบ ภ.พ.30 รายเดือน · ย้ายภาษีซื้อและหักกลบภาษีขาย ลงบัญชีวันสิ้นเดือน · ดูรายละเอียดที่ <Link href="/reports/sales-tax">ภาษีขาย</Link> / <Link href="/reports/purchase-tax">ภาษีซื้อ</Link></p></div></div>
      {canW && <Pp30Create defaultMonth={prev.toISOString().slice(0, 7)} />}
      <div className="panel" style={{ padding: 0, overflowX: 'auto' }}>
        <table><thead><tr><th>เดือนที่ยื่นแบบ</th><th>แบบ</th><th className="num">ภาษีขาย</th><th className="num">ภาษีซื้อ</th><th className="num">ภาษีที่ต้องชำระ / ขอคืน</th><th>สถานะ</th><th /></tr></thead>
          <tbody>{rows.map(r => <tr key={r.id}><td>{r.m}</td><td>ภ.พ.30</td><td className="num">{money(r.o)}</td><td className="num">{money(r.i)}</td>
            <td className="num">{r.result === 'refund' ? `ขอคืน ${money(r.amt)}` : money(r.result === 'payable' ? r.amt : 0)}</td><td>{status(r)}</td>
            <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{canW && <>
              {r.result === 'payable' && !r.paid && <Pp30Pay id={r.id} accounts={banks} defaultDate={today()} />}
              {r.paid && <ActionButton action={resetPp30Payment.bind(null, r.id)} label="รีเซ็ตการชำระ" variant="ghost" confirmText="รีเซ็ตการบันทึกชำระ?" />}
              {r.result === 'refund' && <ActionButton action={setPp30Refund.bind(null, r.id, !r.refund_recorded)} label={r.refund_recorded ? 'รีเซ็ตขอคืน' : 'บันทึกขอคืน'} variant="ghost" />}
              {!r.paid && <ActionButton action={deletePp30.bind(null, r.id)} label="ลบแบบ" variant="danger" confirmText="ลบแบบ? รายการบัญชีของแบบจะถูกกลับรายการ (-R)" />}</>}</td></tr>)}
            {rows.length === 0 && <tr><td colSpan={7} className="empty">ยังไม่มีแบบ ภ.พ.30</td></tr>}</tbody></table>
      </div>
    </>
  );
}
