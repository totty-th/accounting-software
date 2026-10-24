import { can } from '@/lib/permissions';
import { requirePage } from '@/lib/auth';
import Link from 'next/link';
import { getDb } from '@/lib/db';
import { money } from '@/lib/format';
import { Group } from '@/components/Board';
import { BankTools } from '@/components/BankTools';
import { BankTransfer } from '@/components/BankTransfer';

export default async function Bank() {
  const user = await requirePage('bank.read');
  const W = can(user.role, 'bank.write');
  const db = await getDb();
  const banks = await db.q(`select b.id, b.bank_name, b.account_no, b.account_name, a.code,
      (select coalesce(sum(l.debit-l.credit),0) from journal_lines l where l.account_id=b.account_id) ledger
    from bank_accounts b join accounts a on a.id=b.account_id where b.is_active order by a.code`);
  const st = await Promise.all(banks.map(async b =>
    (await db.q('select * from bank_reconcile_status($1)', [b.id]))[0]));
  const cash = await db.q(`select code, name from accounts where code='11112' and is_active`);
  const transferAccts = [...cash.map(c => ({ code: c.code, label: `${c.code} ${c.name}` })),
    ...banks.map(b => ({ code: b.code, label: `${b.code} ${b.bank_name} ${b.account_no}` }))];
  return (
    <>
      <div className="top"><div><h1>ธนาคารและกระทบยอด</h1>
        <p className="sub">นำเข้ารายการเดินบัญชี แล้วจับคู่กับรายการในสมุดบัญชี</p></div>
        {W && transferAccts.length > 1 && <BankTransfer accounts={transferAccts} />}</div>
      {W && <BankTools banks={banks.map(b => ({ id: b.id, label: `${b.bank_name} ${b.account_no}` }))} />}
      <Group title="บัญชีธนาคาร" color="var(--teal)" count={banks.length}>
        {banks.length === 0 ? <div className="empty">ยังไม่มีบัญชีธนาคาร เพิ่มด้านบน</div> : (
          <table><thead><tr><th>บัญชี</th><th className="num">ยอดในสมุดบัญชี</th><th className="num">ยอดตาม statement</th>
            <th className="num">กระทบยอดแล้ว</th><th className="num">ผลต่าง</th><th /></tr></thead>
            <tbody>{banks.map((b, i) => {
              const s = st[i];
              return (
                <tr key={b.id}>
                  <td className="no">{b.bank_name} {b.account_no} <span style={{ fontWeight: 400 }}>({b.code})</span></td>
                  <td className="num">{money(b.ledger)}</td>
                  <td className="num">{s.total_lines ? money(s.bank_balance) : '-'}</td>
                  <td className="num">{s.matched_lines}/{s.total_lines}</td>
                  <td className="num" style={{ color: Number(s.diff) !== 0 && s.total_lines ? 'var(--red)' : undefined }}>{s.total_lines ? money(s.diff) : '-'}</td>
                  <td><Link className="btn sm" href={`/bank/${b.id}`}>กระทบยอด</Link></td>
                </tr>);
            })}</tbody></table>)}
      </Group>
    </>
  );
}
