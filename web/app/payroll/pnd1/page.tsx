import { requirePage } from '@/lib/auth';
import { getDb, today } from '@/lib/db';
import { money, dateTh } from '@/lib/format';
import { payrollEnabled } from '@/lib/modules';
import { PayrollOff } from '@/components/PayrollGate';
import { monthRange, monthTh, dueOf, pnd1Data } from '@/lib/pnd1';

export const dynamic = 'force-dynamic';
// ภ.ง.ด.1 รายเดือน (FA ไม่มี — เพิ่มตามที่เจ้าของระบบสั่ง 16-11-2026): เงินได้ 40(1)/40(2) ที่จ่ายจริงในเดือน ตามวันที่ชำระของรายการเงินเดือน
export default async function Pnd1({ searchParams }: { searchParams: { m?: string } }) {
  await requirePage('payroll.read');
  if (!(await payrollEnabled())) return <PayrollOff />;
  const db = await getDb();
  const { ym, from, to } = monthRange(searchParams.m, today());
  const d = await pnd1Data(db, from, to);
  const co = (await db.q<any>('select * from company_profile'))[0] ?? {};
  const due = dueOf(ym);
  return (
    <>
      <div className="top"><div><h1>ภ.ง.ด.1 รายเดือน</h1>
        <p className="sub">เดือนภาษี {monthTh(ym)} · ยื่นแบบกระดาษภายใน {due(7)} · ยื่นออนไลน์ภายใน {due(15)}</p></div>
        <form method="get" style={{ display: 'flex', gap: 8, alignItems: 'end' }}>
          <label className="f">เดือนที่จ่าย<input type="month" name="m" defaultValue={ym} /></label>
          <button className="btn ghost">แสดง</button>
          <a className="btn" href={`/payroll/pnd1/export?m=${ym}`}>ดาวน์โหลด Excel</a></form></div>
      <div className="panel"><div className="taxhead"><div>
        <h2 style={{ margin: 0 }}>{co.name ?? ''}</h2>
        <div className="sub">เลขประจำตัวผู้เสียภาษีอากร {co.tax_id ?? '-'}</div>
        <div className="sub">ช่วงวันที่จ่าย {dateTh(from)} - {dateTh(to)}</div></div>
        <div className="taxsum"><div className="sub">เงินได้ที่จ่ายรวม<b>{money(d.income)}</b></div>
          <div className="sub">ภาษีที่นำส่งรวม<b>{money(d.wht401 + d.wht402)}</b></div></div></div></div>
      <div className="panel" style={{ padding: 0, overflowX: 'auto' }}>
        <table><thead><tr><th>สรุปรายการภาษีที่นำส่ง</th><th className="num">จำนวนราย</th><th className="num">เงินได้ทั้งสิ้น</th><th className="num">ภาษีที่นำส่งทั้งสิ้น</th></tr></thead>
          <tbody>
            <tr><td>1. เงินได้ตามมาตรา 40 (1) เงินเดือน ค่าจ้าง ฯลฯ กรณีทั่วไป</td><td className="num">{d.n401}</td><td className="num">{money(d.income)}</td><td className="num">{money(d.wht401)}</td></tr>
            <tr><td>4. เงินได้ตามมาตรา 40 (2) กรณีผู้รับเงินได้อยู่ในประเทศไทย</td><td className="num">{d.n402}</td><td className="num">-</td><td className="num">{money(d.wht402)}</td></tr>
            <tr><td><b>รวม</b></td><td className="num"><b>{d.n401}</b></td><td className="num"><b>{money(d.income)}</b></td><td className="num"><b>{money(d.wht401 + d.wht402)}</b></td></tr></tbody></table>
      </div>
      <div className="panel" style={{ padding: 0, overflowX: 'auto' }}>
        {d.rows.length === 0 ? <div className="empty">ไม่มีการจ่ายเงินเดือนที่ชำระแล้วในเดือนนี้</div> :
          <table><thead><tr><th>ลำดับ</th><th>เลขประจำตัวผู้เสียภาษี</th><th>ชื่อผู้มีเงินได้</th><th>วันที่จ่าย</th>
            <th className="num">จำนวนเงินได้ที่จ่าย</th><th className="num">ภาษี 40(1)</th><th className="num">ภาษี 40(2)</th><th>เงื่อนไข</th></tr></thead>
            <tbody>{d.rows.map((r, i) => <tr key={r.code}><td>{i + 1}</td><td>{r.tax_id || <span className="err">ไม่มีเลขบัตร</span>}</td>
              <td>{r.name}<div className="sub">{r.code}</div></td><td>{dateTh(r.date)}</td><td className="num">{money(r.income)}</td>
              <td className="num">{money(r.wht401)}</td><td className="num">{money(r.wht402)}</td><td>1 หัก ณ ที่จ่าย</td></tr>)}</tbody></table>}
      </div>
      <p className="sub">นับเฉพาะรายการเงินเดือนที่ชำระแล้ว ตามวันที่ชำระ · เงินได้ = เงินเดือน/ค่าจ้าง + OT + คอมมิชชั่น − หักขาด/ลา/สาย · กรณีพนักงานหลายรายการในเดือนเดียวรวมเป็นแถวเดียว (วันที่จ่ายล่าสุด)</p>
    </>
  );
}
