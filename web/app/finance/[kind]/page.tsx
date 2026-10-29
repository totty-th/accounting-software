import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePage } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { getDb } from '@/lib/db';
import { money } from '@/lib/format';
import { BankTransfer } from '@/components/BankTransfer';
import { FinCardMenu } from '@/components/FinCardMenu';
import { FinAdd } from '@/components/FinAdd';
import { FIN_KINDS } from '@/lib/finance';

export const dynamic = 'force-dynamic';
const KINDS = FIN_KINDS;
type Kind = (typeof KINDS)[number];
const TITLE: Record<Kind, string> = { 'petty-cash': 'บัญชีเงินสดย่อย', cheque: 'บัญชีเช็คจ่าย', 'credit-card': 'บัตรเครดิตจ่าย' };

// หมวด "การเงิน" แบบ FA (REA 29-10-2026): สรุปยอดรวม + การ์ดบัญชี (ชื่อ/วงเงิน/ยอดคงเหลือ) + ปุ่ม … + การ์ดเพิ่มบัญชี · สลับ "แสดงบัญชีที่ใช้งาน"
// ยอดเงินสดย่อย = เดบิต−เครดิต · เช็คจ่ายรอตัดและบัตรเครดิต = เครดิต−เดบิต (เป็นเจ้าหนี้)
export default async function Finance({ params, searchParams }: { params: { kind: string }; searchParams: { all?: string } }) {
  if (!(KINDS as readonly string[]).includes(params.kind)) notFound();
  const kind = params.kind as Kind;
  const user = await requirePage('bank.read');
  const canMove = can(user.role, 'bank.write'), canEdit = can(user.role, 'master.write');
  const showAll = searchParams.all === '1';
  const db = await getDb();
  const bal = `(select coalesce(sum(l.debit - l.credit), 0) from journal_lines l where l.account_id = a.id)`;
  let rows: any[];
  if (kind === 'petty-cash') rows = await db.q(`select f.id, a.code, f.fund_name name, f.credit_limit lim, f.responsible, f.is_active active, ${bal} bal from petty_funds f join accounts a on a.id = f.account_id order by f.fund_name`);
  else if (kind === 'credit-card') rows = await db.q(`select c.id, a.code, c.card_name name, c.bank_name, c.last4, c.holder_name holder, c.credit_limit lim, c.statement_day, c.due_day, c.is_active active, -${bal} bal from credit_cards c join accounts a on a.id = c.account_id order by c.card_name`);
  else rows = await db.q(`select b.bank_account_id id, a.code, bk.bank_name, bk.account_no, bk.account_name, b.is_active active, -${bal} bal from cheque_accounts b join accounts a on a.id = b.account_id join bank_accounts bk on bk.id = b.bank_account_id order by bk.bank_name, bk.account_no`);
  const shown = rows.filter(r => showAll || r.active), live = rows.filter(r => r.active);
  const sum = (k: string) => live.reduce((t, r) => t + Number(r[k] ?? 0), 0);
  const banks = await db.q(`select b.id, b.bank_name, b.account_no, a.code from bank_accounts b join accounts a on a.id = b.account_id where b.is_active order by a.code`);
  const petties = await db.q(`select a.code, f.fund_name from petty_funds f join accounts a on a.id = f.account_id where f.is_active order by f.fund_name`);
  const cards = await db.q(`select a.code, c.card_name from credit_cards c join accounts a on a.id = c.account_id where c.is_active order by c.card_name`);
  const cash = await db.q(`select code, name from accounts where code = '11112' and is_active`);
  const sources = [...cash.map(c => ({ code: c.code, label: `${c.name} (${c.code})` })), ...banks.map(b => ({ code: b.code, label: `${b.bank_name} ${b.account_no}` }))];
  const accounts = [...sources, ...petties.map(p => ({ code: p.code, label: `เงินสดย่อย - ${p.fund_name}` })), ...cards.map(c => ({ code: c.code, label: `บัตรเครดิต - ${c.card_name}` }))];
  const label = (r: any) => kind === 'cheque' ? `${r.bank_name} ${r.account_no}` : kind === 'credit-card' ? `${r.name} •••• ${r.last4}` : r.name;
  return (
    <>
      <div className="top"><div><h1>{TITLE[kind]}</h1><p className="sub">
        {kind === 'petty-cash' ? 'วงเงินสดย่อยแต่ละบัญชี เติมเงินจากเงินสด/ธนาคาร · จ่ายค่าใช้จ่ายจากเอกสารซื้อ' : kind === 'cheque' ? 'เช็คที่จ่ายแล้วแต่ธนาคารยังไม่ตัดบัญชี (ผูกกับบัญชีธนาคาร)' : 'บัตรเครดิตที่ใช้จ่ายค่าใช้จ่าย · ชำระบิลด้วยการโอนเงินไปบัญชีบัตร'}</p></div>
        {canMove && kind !== 'cheque' && accounts.length > 1 && <BankTransfer accounts={accounts} />}</div>
      <div className="cards">
        {kind === 'petty-cash' && <div className="card" style={{ ['--c' as any]: 'var(--teal)' }}><span>วงเงินสดย่อยทั้งหมด</span><b>{money(sum('lim'))} บาท</b></div>}
        <div className="card" style={{ ['--c' as any]: 'var(--blue)' }}><span>{kind === 'cheque' ? 'เช็คจ่ายรอตัดจ่ายทั้งหมด' : 'ยอดคงเหลือทั้งหมดในระบบ'}</span><b>{money(sum('bal'))} บาท</b></div>
      </div>
      <div className="row-inline noprint" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <b>{TITLE[kind].replace('บัญชี', '').replace('จ่าย', '')}ทั้งหมด {live.length} บัญชี</b>
        <Link className="btn sm ghost" href={`/finance/${kind}${showAll ? '' : '?all=1'}`}>{showAll ? 'แสดงเฉพาะที่ใช้งาน' : 'แสดงรวมที่ไม่ใช้งาน'}</Link></div>
      <div className="fincards">
        {shown.length === 0 && <div className="empty">ยังไม่มีบัญชี เพิ่มด้านล่าง</div>}
        {shown.map(r => {
          const free = kind === 'petty-cash' ? Math.max(0, Number(r.lim) - Number(r.bal)) : 0;
          return (
            <div key={r.id} className={`fincard ${r.active ? '' : 'off'}`} style={{ ['--c' as any]: kind === 'petty-cash' ? 'var(--teal)' : kind === 'cheque' ? 'var(--purple)' : 'var(--blue)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <div><b>{kind === 'cheque' ? r.bank_name : r.name}</b>{!r.active && <small className="sub"> (ไม่ใช้งาน)</small>}
                  <div className="sub">{kind === 'cheque' ? <>{r.account_no} · {r.account_name ?? ''}</> : kind === 'credit-card' ? <>•••• •••• •••• {r.last4} · ครบกำหนดทุกวันที่ {r.due_day}</> : r.responsible ?? ''}</div></div>
                <FinCardMenu kind={kind} id={r.id} code={r.code} active={r.active} canEdit={canEdit} canMove={canMove} label={label(r)} sources={sources} accounts={accounts}
                  init={{ name: r.name, limit: Number(r.lim ?? 0), responsible: r.responsible ?? '', bank: r.bank_name, last4: r.last4, holder: r.holder, statementDay: r.statement_day, dueDay: r.due_day, free }} /></div>
              {kind === 'petty-cash' && <div className="row"><span>วงเงินสดย่อย</span><b>{money(r.lim)}</b></div>}
              {kind === 'credit-card' && <div className="row"><span>วงเงิน</span><b>{money(r.lim)}</b></div>}
              <div className="row"><span>{kind === 'cheque' ? 'เช็ครอตัดจ่าย' : kind === 'petty-cash' ? 'ยอดเงินคงเหลือ' : 'ยอดในระบบ'}</span><Link href={`/finance/${kind}/${r.id}`}><b>{money(r.bal)}</b></Link></div>
            </div>); })}
      </div>
      {canEdit && <FinAdd kind={kind} banks={banks.map(b => ({ id: b.id, label: `${b.bank_name} ${b.account_no}` }))} />}
    </>
  );
}
