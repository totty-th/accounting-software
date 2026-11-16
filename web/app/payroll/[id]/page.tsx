import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePage } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { getDb } from '@/lib/db';
import { money, dateTh, dateIso } from '@/lib/format';
import { payrollEnabled } from '@/lib/modules';
import { PayrollOff } from '@/components/PayrollGate';
import { PayrollPayForm } from '@/components/PayrollPayForm';
import { ActionButton } from '@/components/ActionButton';
import { cancelPayrollRun, resetPayrollPayment } from '@/lib/actions';
import { RUN_STATUS, RUN_TYPE, PAY_METHOD, empName } from '@/lib/payroll';

export const dynamic = 'force-dynamic';
export default async function Run({ params }: { params: { id: string } }) {
  const u = await requirePage('payroll.read');
  if (!(await payrollEnabled())) return <PayrollOff />;
  if (!/^[0-9a-f-]{36}$/.test(params.id)) notFound();
  const db = await getDb();
  const r = (await db.q<any>(`select r.*, a.voucher_no av, p.voucher_no pv from payroll_runs r left join journal_vouchers a on a.id = r.accrual_voucher_id
      left join journal_vouchers p on p.id = r.payment_voucher_id where r.id=$1`, [params.id]))[0];
  if (!r) notFound();
  const lines = await db.q<any>(`select l.*, e.code, e.title, e.first_name, e.last_name, e.pay_method emp_method, e.bank_name, e.bank_account_no
      from payroll_lines l join employees e on e.id = l.employee_id where l.run_id=$1 order by e.code`, [r.id]);
  const hist = await db.q<any>(`select id, voucher_no, memo, voucher_date from journal_vouchers where source_id=$1 and source_type in ('PAYROLL','PAYROLL_PAY')
      or reverses_id in (select id from journal_vouchers where source_id=$1 and source_type in ('PAYROLL','PAYROLL_PAY')) order by created_at`, [r.id]);
  const bank = (await db.q<any>(`select b.bank_name || ' ' || b.account_no l from payroll_settings s join bank_accounts b on b.id = s.bank_account_id`))[0]?.l ?? null;
  const t = lines.reduce((a: any, l: any) => ({ base: a.base + +l.base, add: a.add + +l.ot + +l.commission,
    ded: a.ded + +l.absence + +l.other_deduct + +l.sso_employee + +l.wht_401 + +l.wht_402, net: a.net + +l.net, cost: a.cost + +l.base + +l.ot + +l.commission + +l.sso_employer }),
    { base: 0, add: 0, ded: 0, net: 0, cost: 0 });
  const w = can(u.role, 'payroll.write'), daily = r.pay_type === 'daily';
  return (
    <>
      <div className="top"><div><h1>{RUN_TYPE[r.pay_type]} {dateTh(r.period_from)} – {dateTh(r.period_to)} <span className={`pill ${RUN_STATUS[r.status][1]}`}>{RUN_STATUS[r.status][0]}</span></h1>
        <p className="sub">ทำรายการ {dateTh(r.doc_date)} · วันที่ชำระ {dateTh(r.paid_date ?? r.pay_date)} · จ่าย{PAY_METHOD[r.pay_method]}{r.note ? ` · ${r.note}` : ''}</p></div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {w && r.status === 'pending' && <Link className="btn sm ghost" href={`/payroll/${r.id}/edit`}>แก้ไข</Link>}
          {w && r.status === 'pending' && <ActionButton action={cancelPayrollRun.bind(null, r.id)} label="ยกเลิก" variant="danger" confirmText="ยกเลิกรายการเงินเดือนนี้? (กลับรายการบัญชีค้างจ่าย)" />}
          {w && r.status === 'paid' && <ActionButton action={resetPayrollPayment.bind(null, r.id)} label="รีเซ็ตการชำระ" variant="ghost" confirmText="รีเซ็ตการชำระ? (กลับรายการบัญชีจ่ายเงิน)" />}
          <Link className="btn sm ghost" href="/payroll">กลับ</Link></div></div>
      <div className="panel wide" style={{ padding: 0, overflowX: 'auto' }}>
        <table><thead><tr><th>พนักงาน</th><th>ช่องทางรับชำระ</th>{daily && <><th className="num">วัน</th><th className="num">ค่าจ้าง/วัน</th></>}
          <th className="num">{daily ? 'ค่าจ้างรวม' : 'เงินเดือน'}</th><th className="num">ปรับเพิ่ม</th><th className="num">ปรับลด</th><th className="num">ประกันสังคม</th>
          <th className="num">หัก ณ ที่จ่าย</th><th className="num">ยอดจ่ายสุทธิ</th><th /></tr></thead>
          <tbody>{lines.map((l: any) => <tr key={l.employee_id}>
            <td>{empName(l)}<div className="sub">{l.code}</div></td>
            <td>{r.pay_method === 'transfer' ? `${l.bank_name ?? '-'} ${l.bank_account_no ?? ''}` : 'เงินสด'}</td>
            {daily && <><td className="num">{Number(l.days)}</td><td className="num">{money(l.rate)}</td></>}
            <td className="num">{money(l.base)}</td><td className="num">{money(+l.ot + +l.commission)}</td>
            <td className="num">({money(+l.absence + +l.other_deduct)})</td><td className="num">({money(l.sso_employee)})</td>
            <td className="num">({money(+l.wht_401 + +l.wht_402)})</td><td className="num"><b>{money(l.net)}</b></td>
            <td><Link href={`/payroll/${r.id}/slip/${l.employee_id}`}>สลิป</Link></td></tr>)}</tbody></table>
      </div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div className="panel" style={{ minWidth: 300 }}>
          <div className="taxbox" style={{ border: 0, padding: 0 }}>
            <div><span>จำนวนพนักงาน</span><b>{lines.length} คน</b></div><div><span>ยอดรวม{RUN_TYPE[r.pay_type]}</span><b>{money(t.base)}</b></div>
            <div><span>รวมรายการปรับเพิ่ม</span><b>{money(t.add)}</b></div><div><span>รวมรายการปรับลด</span><b>{money(t.ded)}</b></div>
            <div><span>รวมจ่ายสุทธิ</span><b>{money(t.net)}</b></div><div><span>รวมค่าใช้จ่ายพนักงาน</span><b>{money(t.cost)}</b></div>
            {r.status === 'paid' && +r.fee > 0 && <div><span>ค่าธรรมเนียมโอน</span><b>{money(r.fee)}</b></div>}</div></div>
        <div className="panel" style={{ minWidth: 300 }}>
          <h3 style={{ marginTop: 0 }}>รายการบัญชี</h3>
          <ul className="rel">{hist.map((h: any) => <li key={h.voucher_no}><Link href={`/journals/${h.id}`}>{h.voucher_no}</Link> {h.memo} <span className="sub">{dateTh(h.voucher_date)}</span></li>)}
            {hist.length === 0 && <li className="sub">ยังไม่มี</li>}</ul></div>
      </div>
      {w && r.status === 'pending' && <PayrollPayForm id={r.id} date={dateIso(r.pay_date)} method={r.pay_method} net={money(t.net)} bank={bank} />}
    </>
  );
}
