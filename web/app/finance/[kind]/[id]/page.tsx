import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePage } from '@/lib/auth';
import { getDb, today } from '@/lib/db';
import { money, dateTh, dateIso } from '@/lib/format';
import { periodRange } from '@/lib/period';
import { reportPeriod, periodLabel } from '@/lib/report-filter';
import { ReportFilter } from '@/components/ReportFilter';
import { ReportTools } from '@/components/ReportTools';
import { FIN_KINDS as KINDS } from '@/lib/finance';

export const dynamic = 'force-dynamic';
type Sp = { period?: string; from?: string; to?: string };

// รายการเคลื่อนไหวของบัญชีการเงิน (แบบ FA "ยอดใน FlowAccount: …"): วันที่/เลขที่อ้างอิง(ใบสำคัญ)/รายละเอียด/เงินเข้า/เงินออก/ยอดคงเหลือ
export default async function FinMovements({ params, searchParams }: { params: { kind: string; id: string }; searchParams: Sp }) {
  if (!(KINDS as readonly string[]).includes(params.kind)) notFound();
  await requirePage('bank.read');
  const db = await getDb();
  const kind = params.kind;
  const row = (await db.q<any>(kind === 'petty-cash' ? `select account_id, 'เงินสดย่อย - ' || fund_name title from petty_funds where id = $1`
    : kind === 'credit-card' ? `select account_id, 'บัตรเครดิต - ' || card_name title from credit_cards where id = $1`
    : `select c.account_id, 'เช็คจ่าย - ' || b.bank_name || ' ' || b.account_no title from cheque_accounts c join bank_accounts b on b.id = c.bank_account_id where c.bank_account_id = $1`, [params.id]))[0];
  if (!row) notFound();
  const sign = kind === 'petty-cash' ? 1 : -1;          // เงินสดย่อย: เข้า=เดบิต · เช็ค/บัตร (เจ้าหนี้): เพิ่ม=เครดิต
  const period = reportPeriod(searchParams.period);
  const range = periodRange(period, today(), searchParams.from, searchParams.to);
  const open = range ? Number((await db.q<any>(`select coalesce(sum(debit - credit), 0) b from journal_lines l join journal_vouchers v on v.id = l.voucher_id where l.account_id = $1 and v.voucher_date < $2::date`, [row.account_id, range[0]]))[0].b) * sign : 0;
  const mv = await db.q<any>(`select * from account_movements($1, $2::date, $3::date)`, [row.account_id, range?.[0] ?? null, range?.[1] ?? null]);
  let run = open;
  const lines = mv.map(m => { const inn = sign === 1 ? Number(m.debit) : Number(m.credit), out = sign === 1 ? Number(m.credit) : Number(m.debit); run += inn - out; return { ...m, inn, out, run }; });
  return (
    <>
      <div className="top"><div><p className="sub"><Link href={`/finance/${kind}`}>← ย้อนกลับ</Link></p><h1>ยอดในระบบ: {row.title}</h1>
        <p className="sub">ช่วงเวลา {periodLabel(range)}</p></div>
        <div className="panel" style={{ textAlign: 'right' }}><span className="sub">{kind === 'cheque' ? 'เช็ครอตัดจ่าย' : 'ยอดคงเหลือ'}</span><b style={{ display: 'block', fontSize: 22 }}>{money(run)}</b></div></div>
      <ReportFilter period={period} from={searchParams.from} to={searchParams.to} />
      <ReportTools title={`รายการเคลื่อนไหว ${row.title}`} />
      <div data-report className="panel" style={{ padding: 0, overflowX: 'auto' }}>
        {lines.length === 0 ? <div className="empty">ไม่มีรายการในช่วงที่เลือก</div> :
          <table><thead><tr><th>วันที่</th><th>เลขที่อ้างอิง</th><th>รายละเอียด/คำอธิบายรายการ</th><th className="num">เงินเข้า</th><th className="num">เงินออก</th><th className="num">ยอดคงเหลือ</th></tr></thead>
            <tbody>{lines.map((m, i) => (
              <tr key={i}><td>{dateTh(m.voucher_date)}</td><td className="no"><Link href={`/journals/${m.voucher_id}`}>{m.voucher_no}</Link></td><td>{m.memo}</td>
                <td className="num">{m.inn ? money(m.inn) : ''}</td><td className="num">{m.out ? money(m.out) : ''}</td><td className="num">{money(m.run)}</td></tr>))}</tbody></table>}
      </div>
    </>
  );
}
