import { can } from '@/lib/permissions';
import { requirePage } from '@/lib/auth';
import { getDb, today } from '@/lib/db';
import { money, dateTh, partyName } from '@/lib/format';
import { Pill } from '@/components/Pill';
import { Group } from '@/components/Board';
import { ActionButton } from '@/components/ActionButton';
import { PayForm } from '@/components/PayForm';
import { CardForm } from '@/components/CardForm';
import { RiForm } from '@/components/RiForm';
import * as A from '@/lib/actions';

export default async function Purchases() {
  const user = await requirePage('expenses.read');
  const W = can(user.role, 'expenses.write'), AP = can(user.role, 'expenses.approve'), MW = can(user.role, 'master.write');
  const db = await getDb();
  const rows = await db.q(`select g.*, c.business_name, c.contact_name,
      (select string_agg(p.code || ' ×' || trim(trailing '.' from trim(trailing '0' from l.qty::text)), ', ' order by l.line_no)
         from goods_receipt_lines l join products p on p.id=l.product_id where l.ri_id=g.id) items
    from goods_receipts g join contacts c on c.id=g.contact_id order by g.ri_date desc, g.ri_no desc`);
  const banks = (await db.q(`select id, bank_name, account_no from bank_accounts where is_active order by bank_name`))
    .map(b => ({ id: b.id as string, label: `${b.bank_name} ${b.account_no}` }));
  const cards = (await db.q(`select id, card_name, last4 from credit_cards where is_active order by card_name`))
    .map(c => ({ id: c.id as string, label: `${c.card_name} ****${c.last4}` }));
  const vendors = (await db.q(`select id, business_name, contact_name from contacts where not is_cash_default and is_vendor order by business_name nulls last`))
    .map(c => ({ id: c.id as string, label: partyName(c) }));
  const products = (await db.q(`select id, code, name, purchase_price from products where kind='goods_stock' order by code`))
    .map(p => ({ id: p.id as string, label: `${p.code} ${p.name}`, price: Number(p.purchase_price) }));
  const sets: [string, string, string][] = [['unpaid', 'รออนุมัติ', 'var(--orange)'], ['approved', 'อนุมัติแล้ว', 'var(--blue)'],
    ['paid', 'ชำระแล้ว', 'var(--green)'], ['rejected', 'ไม่อนุมัติ', 'var(--red)'], ['cancelled', 'ยกเลิก', 'var(--grey)']];
  return (
    <>
      <div className="top"><div><h1>ใบรับสินค้า</h1>
        <p className="sub">บันทึกแล้วสินค้าเข้าสต็อกและตั้งเจ้าหนี้ทันที · ไม่อนุมัติ = กลับรายการและถอนสต็อก</p></div></div>
      {W && <RiForm vendors={vendors} products={products} today={today()} />}
      {MW && <CardForm />}
      {rows.length === 0 && <div className="panel empty">ยังไม่มีใบรับสินค้า</div>}
      {sets.map(([s, title, color]) => {
        const rs = rows.filter(r => r.status === s); if (!rs.length) return null;
        return (
          <Group key={s} title={title} color={color} count={rs.length}>
            <table><thead><tr><th>เลขที่</th><th>ผู้ขาย</th><th>รายการ</th><th>วันที่</th><th className="num">ยอดรวม</th><th>สถานะ</th><th /></tr></thead>
              <tbody>{rs.map(r => (
                <tr key={r.id}><td className="no">{r.ri_no}</td><td>{partyName(r)}</td><td>{r.items}</td><td>{dateTh(r.ri_date)}</td>
                  <td className="num">{money(r.total)}</td><td><Pill s={r.status} /></td>
                  <td><div className="acts">
                    {AP && r.status === 'unpaid' && <ActionButton label="อนุมัติ" variant="ghost" action={A.approveGoodsReceipt.bind(null, r.id)} />}
                    {AP && (r.status === 'unpaid' || r.status === 'approved') && <ActionButton label="ไม่อนุมัติ" variant="ghost" action={A.rejectGoodsReceipt.bind(null, r.id)} />}
                    {W && (r.status === 'unpaid' || r.status === 'approved') && (
                      <details><summary className="btn sm">จ่ายเงิน</summary>
                        <PayForm net={Number(r.total)} banks={banks} cards={cards} onPay={A.payGoodsReceipt.bind(null, r.id)} /></details>)}
                    {W && ['approved', 'paid', 'rejected'].includes(r.status) && <ActionButton label="รีเซ็ต" variant="ghost" action={A.resetGoodsReceipt.bind(null, r.id)} />}
                    {W && r.status !== 'cancelled' && <ActionButton label="ยกเลิก" variant="danger" confirmText="c" action={A.cancelGoodsReceipt.bind(null, r.id)} />}
                  </div></td></tr>))}</tbody></table>
          </Group>);
      })}
    </>
  );
}
