import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDb } from '@/lib/db';
import { money, dateIso } from '@/lib/format';
import { ReconcileBoard } from '@/components/ReconcileBoard';

export default async function Reconcile({ params, searchParams }: { params: { id: string }; searchParams: { batch?: string } }) {
  const db = await getDb();
  const b = (await db.q(`select b.id, b.bank_name, b.account_no, a.code from bank_accounts b join accounts a on a.id=b.account_id where b.id=$1`, [params.id]))[0];
  if (!b) notFound();
  const batches = await db.q(`select id, file_name, created_at, (select count(*)::int from bank_statement_lines l where l.batch_id=x.id) n
    from bank_statement_batches x where bank_account_id=$1 order by created_at`, [b.id]);
  const batch = searchParams.batch && batches.some(x => x.id === searchParams.batch) ? searchParams.batch : null;
  const lines = await db.q(`select s.id, s.line_date, s.description, s.amount, s.group_id, (g.diff_voucher_id is not null) has_diff
      from bank_statement_lines s left join bank_reconcile_groups g on g.id=s.group_id
     where s.bank_account_id=$1 and ($2::uuid is null or s.batch_id=$2) order by s.line_date, s.batch_id, s.line_no`, [b.id, batch]);
  const items = await db.q('select * from bank_book_items($1)', [b.id]);
  const st = (await db.q('select * from bank_reconcile_status($1,$2)', [b.id, batch]))[0];
  const accts = await db.q(`select code, name, type from accounts where is_active and code <> $1 and code !~ '^11122\\.' order by code`, [b.code]);
  return (
    <>
      <div className="top"><div>
        <h1>กระทบยอด {b.bank_name} {b.account_no}</h1>
        <p className="sub"><Link href="/bank">← ธนาคารทั้งหมด</Link> · บัญชี {b.code}</p></div></div>
      <div className="cards">
        <div className="card" style={{ ['--c' as any]: 'var(--teal)' }}><span>ยอดบัญชีตาม statement</span><b>{money(st.bank_balance)}</b></div>
        <div className="card" style={{ ['--c' as any]: 'var(--blue)' }}><span>ยอดสมุดบัญชี (เฉพาะที่จับคู่แล้ว)</span><b>{money(st.book_matched)}</b></div>
        <div className="card" style={{ ['--c' as any]: Number(st.diff) === 0 ? 'var(--green)' : 'var(--red)' }}><span>ผลต่าง</span><b>{money(st.diff)}</b></div>
        <div className="card" style={{ ['--c' as any]: 'var(--orange)' }}><span>กระทบยอดแล้ว</span><b>{st.matched_lines}/{st.total_lines} รายการ</b></div>
      </div>
      {batches.length > 1 && (
        <p className="sub">ชุดข้อมูล: <Link href={`/bank/${b.id}`}>ทั้งหมด</Link>{batches.map(x => <span key={x.id}> · <Link href={`/bank/${b.id}?batch=${x.id}`}>{x.file_name ?? 'ไม่มีชื่อ'} ({x.n})</Link></span>)}</p>)}
      <ReconcileBoard
        lines={lines.map(l => ({ id: l.id, date: dateIso(l.line_date), description: l.description ?? '', amount: Number(l.amount), matched: !!l.group_id, hasDiff: !!l.has_diff }))}
        items={items.map(i => ({ id: i.journal_line_id, date: dateIso(i.voucher_date), no: i.voucher_no, memo: i.memo ?? '', amount: Number(i.amount), matched: !!i.group_id }))}
        accounts={accts.map(a => ({ code: a.code, label: `${a.code} ${a.name}`, type: a.type }))} />
    </>
  );
}
