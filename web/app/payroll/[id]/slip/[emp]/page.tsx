import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePage } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { money, dateTh } from '@/lib/format';
import { payrollEnabled } from '@/lib/modules';
import { PayrollOff } from '@/components/PayrollGate';
import { PrintButton } from '@/components/ShareTools';
import { RUN_TYPE, empName } from '@/lib/payroll';

export const dynamic = 'force-dynamic';
/** สลิปเงินเดือนรายคน (พิมพ์/บันทึก PDF จากเบราว์เซอร์) */
export default async function Slip({ params }: { params: { id: string; emp: string } }) {
  await requirePage('payroll.read');
  if (!(await payrollEnabled())) return <PayrollOff />;
  if (!/^[0-9a-f-]{36}$/.test(params.id) || !/^[0-9a-f-]{36}$/.test(params.emp)) notFound();
  const db = await getDb();
  const l = (await db.q<any>(`select l.*, e.*, r.pay_type, r.period_from, r.period_to, r.pay_date, r.paid_date, r.status from payroll_lines l
      join employees e on e.id = l.employee_id join payroll_runs r on r.id = l.run_id where l.run_id=$1 and l.employee_id=$2`, [params.id, params.emp]))[0];
  if (!l) notFound();
  const co = (await db.q<any>(`select name, address, tax_id from company_profile`))[0];
  const ytd = (await db.q<any>(`select coalesce(sum(x.base + x.ot + x.commission),0) inc, coalesce(sum(x.wht_401 + x.wht_402),0) tax, coalesce(sum(x.sso_employee),0) sso
      from payroll_lines x join payroll_runs r on r.id = x.run_id where x.employee_id=$1 and r.status <> 'cancelled'
       and extract(year from r.period_to) = extract(year from $2::date) and r.period_to <= $2::date`, [params.emp, l.period_to]))[0];
  const inc: [string, number][] = [[l.pay_type === 'daily' ? `ค่าจ้าง (${Number(l.days)} วัน × ${money(l.rate)})` : 'เงินเดือน', +l.base], ['ค่าล่วงเวลา', +l.ot], ['ค่าคอมมิชชั่น', +l.commission]];
  const ded: [string, number][] = [['ประกันสังคม', +l.sso_employee], ['ภาษีหัก ณ ที่จ่าย 40(1)', +l.wht_401], ['ภาษีหัก ณ ที่จ่าย 40(2)', +l.wht_402],
    ['หักขาด/ลา/มาสาย', +l.absence], ['เงินหักอื่นๆ', +l.other_deduct]];
  const ti = inc.reduce((s, x) => s + x[1], 0), td = ded.reduce((s, x) => s + x[1], 0);
  const rows = Math.max(inc.filter(x => x[1]).length, ded.filter(x => x[1]).length);
  const I = inc.filter(x => x[1]), D = ded.filter(x => x[1]);
  return (
    <>
      <div className="top noprint"><Link className="btn sm ghost" href={`/payroll/${params.id}`}>กลับ</Link><PrintButton /></div>
      <div className="slip">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <div><h2>{co?.name ?? 'บริษัท'}</h2><div style={{ fontSize: 12 }}>{co?.address ?? ''}{co?.tax_id ? ` · เลขประจำตัวผู้เสียภาษี ${co.tax_id}` : ''}</div></div>
          <div style={{ textAlign: 'right' }}><h2>สลิปเงินเดือน</h2><div style={{ fontSize: 12 }}>PAY SLIP · {RUN_TYPE[l.pay_type]}</div></div></div>
        <hr />
        <table style={{ fontSize: 13 }}><tbody>
          <tr><td>ชื่อพนักงาน</td><td><b>{empName(l)}</b></td><td>รหัสพนักงาน</td><td>{l.code}</td></tr>
          <tr><td>แผนก/ตำแหน่ง</td><td>{[l.department, l.position].filter(Boolean).join(' / ') || '-'}</td><td>งวด</td><td>{dateTh(l.period_from)} – {dateTh(l.period_to)}</td></tr>
          <tr><td>วันที่จ่าย</td><td>{dateTh(l.paid_date ?? l.pay_date)}</td><td>ช่องทาง</td><td>{l.pay_method === 'transfer' ? `โอน ${l.bank_name ?? ''} ${l.bank_account_no ?? ''}` : 'เงินสด'}</td></tr></tbody></table>
        <table style={{ marginTop: 12 }}><thead><tr><th>รายได้</th><th className="num">จำนวนเงิน</th><th>รายการหัก</th><th className="num">จำนวนเงิน</th></tr></thead>
          <tbody>{Array.from({ length: Math.max(rows, 1) }, (_, i) => <tr key={i}>
            <td>{I[i]?.[0] ?? ''}</td><td className="num">{I[i] ? money(I[i][1]) : ''}</td><td>{D[i]?.[0] ?? ''}</td><td className="num">{D[i] ? money(D[i][1]) : ''}</td></tr>)}
            <tr><td><b>รวมรายได้</b></td><td className="num"><b>{money(ti)}</b></td><td><b>รวมรายการหัก</b></td><td className="num"><b>{money(td)}</b></td></tr></tbody></table>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 14, gap: 12, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 12 }}>สะสมทั้งปี: เงินได้ {money(ytd.inc)} · ภาษี {money(ytd.tax)} · ประกันสังคม {money(ytd.sso)}</div>
          <div style={{ fontSize: 18 }}>เงินได้สุทธิ <b>{money(l.net)}</b> บาท</div></div>
        {l.slip_note && <p style={{ fontSize: 12 }}>หมายเหตุ: {l.slip_note}</p>}
        {l.status === 'cancelled' && <p style={{ color: 'var(--red)' }}>รายการนี้ถูกยกเลิกแล้ว</p>}
      </div>
    </>
  );
}
