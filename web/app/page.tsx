import { requirePage } from '@/lib/auth';
import Link from 'next/link';
import { getDb, today, monthStart } from '@/lib/db';
import { money, dateTh, partyName } from '@/lib/format';
import { Pill } from '@/components/Pill';
import { Group } from '@/components/Board';
import { DOC_TYPE } from '@/lib/status';

export default async function Home() {
  await requirePage('dash.view');
  const db = await getDb();
  const from = monthStart(), to = today();
  const bal = async (code: string) =>
    Number((await db.q(`select coalesce(sum(closing),0) c from trial_balance($1::date,$2::date,false) where code=$3`, [from, to, code]))[0].c);
  const [ar, cash, ap1, ap2] = await Promise.all([bal('11311'), bal('11112'), bal('21399'), bal('21311')]);
  const profit = Number((await db.q('select net_profit($1::date,$2::date) p', [from, to]))[0].p);
  const rev = Number((await db.q(`select coalesce(sum(amount),0) r from income_statement($1::date,$2::date) where section='revenue'`, [from, to]))[0].r);
  const todo = (await db.q(`
    select (select count(*) from sales_docs where doc_type='INV' and status in ('awaiting_payment','split_paid')) inv,
           (select count(*) from receipts where status='pending') re,
           (select count(*) from expenses where status in ('pending','approved')) ex,
           (select count(*) from sales_docs where doc_type='QT' and status='pending_approval') qt,
           (select count(*) from stock_alerts) alerts`))[0];
  const recent = await db.q(`select d.id, d.doc_type, d.doc_no, d.doc_date, d.status, d.total, c.business_name, c.contact_name
     from sales_docs d join contacts c on c.id=d.contact_id order by d.created_at desc limit 6`);
  return (
    <>
      <div className="top"><div><h1>ภาพรวม</h1><p className="sub">เดือนนี้ ({dateTh(from)} – {dateTh(to)})</p></div></div>
      <div className="cards">
        <div className="card" style={{ ['--c' as any]: 'var(--green)' }}><span>รายได้เดือนนี้</span><b>{money(rev)}</b></div>
        <div className="card" style={{ ['--c' as any]: profit >= 0 ? 'var(--teal)' : 'var(--red)' }}><span>กำไร(ขาดทุน)เดือนนี้</span><b>{money(profit)}</b></div>
        <div className="card" style={{ ['--c' as any]: 'var(--orange)' }}><span>ลูกหนี้ค้างรับ</span><b>{money(ar)}</b></div>
        <div className="card" style={{ ['--c' as any]: 'var(--purple)' }}><span>เจ้าหนี้ค้างจ่าย</span><b>{money(-(ap1 + ap2))}</b></div>
        <div className="card" style={{ ['--c' as any]: 'var(--blue)' }}><span>เงินสดและเงินฝาก</span><b>{money(cash)}</b></div>
      </div>
      <Group title="งานที่ต้องทำ" color="var(--brand)" count={4}>
        <table><tbody>
          <tr><td><Link href="/sales?type=INV">ใบแจ้งหนี้รอเก็บเงิน</Link></td><td className="num">{todo.inv}</td><td><Link className="btn sm ghost" href="/sales?type=INV">ดู</Link></td></tr>
          <tr><td><Link href="/receipts">ใบเสร็จรอเก็บเงิน</Link></td><td className="num">{todo.re}</td><td><Link className="btn sm ghost" href="/receipts">ดู</Link></td></tr>
          <tr><td><Link href="/expenses">ค่าใช้จ่ายรอดำเนินการ/จ่ายเงิน</Link></td><td className="num">{todo.ex}</td><td><Link className="btn sm ghost" href="/expenses">ดู</Link></td></tr>
          <tr><td><Link href="/sales?type=QT">ใบเสนอราคารออนุมัติ</Link></td><td className="num">{todo.qt}</td><td><Link className="btn sm ghost" href="/sales?type=QT">ดู</Link></td></tr>
        </tbody></table>
      </Group>
      {Number(todo.alerts) > 0 && <div className="notice">มีการขายสินค้าเกินคงเหลือ {todo.alerts} ครั้ง ตรวจสอบที่หน้า <Link href="/stock"><b>สต็อก</b></Link></div>}
      <Group title="เอกสารขายล่าสุด" color="var(--green)" count={recent.length}>
        {recent.length === 0 ? <div className="empty">ยังไม่มีเอกสาร</div> : (
          <table><thead><tr><th>เลขที่</th><th>ประเภท</th><th>ลูกค้า</th><th>วันที่</th><th className="num">ยอดรวม</th><th>สถานะ</th></tr></thead>
            <tbody>{recent.map(r => (
              <tr key={r.id}><td className="no">{r.doc_no}</td><td>{DOC_TYPE[r.doc_type]}</td><td>{partyName(r)}</td>
                <td>{dateTh(r.doc_date)}</td><td className="num">{money(r.total)}</td><td><Pill s={r.status} /></td></tr>))}</tbody></table>)}
      </Group>
    </>
  );
}
