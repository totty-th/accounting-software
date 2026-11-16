'use client';
import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { savePayrollRun } from '@/lib/actions';
import { RUN_TYPE, PAY_METHOD, ssoOf, taxBreakdown } from '@/lib/payroll';

type Emp = { id: string; code: string; name: string; salary: number; sso: boolean; auto_tax: boolean; pay_method: string };
type Line = { employee_id: string; on: boolean; days: string; ot: string; commission: string; absence: string; other_deduct: string;
  sso_employee: string; wht_401: string; wht_402: string; slip_note: string };
const n = (s: string) => Number(s) || 0;
const m = (x: number) => x.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** สร้าง/แก้รายการเงินเดือน · ช่องประกันสังคม/ภาษีว่าง = ให้ระบบคำนวณอัตโนมัติ (ตัวเลขในหน้านี้เป็นตัวอย่าง ยอดจริงคำนวณตอนบันทึก) */
export function PayrollRunForm({ id, payType, method, header, emps, init, ssoOn }:
  { id: string | null; payType: 'monthly' | 'daily'; method: string; header: Record<string, string>; emps: Emp[]; init: Record<string, any>[] | null; ssoOn: boolean }) {
  const r = useRouter();
  const [h, setH] = useState(header);
  const [rows, setRows] = useState<Line[]>(() => emps.map(e => {
    const x = init?.find(l => l.employee_id === e.id);
    const s = (v: unknown) => (v == null || Number(v) === 0 ? '' : String(Number(v)));
    return { employee_id: e.id, on: init ? !!x : true, days: x ? s(x.days) : '', ot: x ? s(x.ot) : '', commission: x ? s(x.commission) : '',
      absence: x ? s(x.absence) : '', other_deduct: x ? s(x.other_deduct) : '', sso_employee: '', wht_401: '',   // แก้รายการ: ประกันสังคม/ภาษีคำนวณใหม่อัตโนมัติ (กรอกทับได้)
     
      wht_402: x ? s(x.wht_402) : '', slip_note: x?.slip_note ?? '' };
  }));
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const upd = (i: number, k: keyof Line, v: string | boolean) => setRows(rs => rs.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const calc = (e: Emp, l: Line) => {
    const base = payType === 'daily' ? Math.round(n(l.days) * e.salary * 100) / 100 : e.salary;
    const sso = l.sso_employee !== '' ? n(l.sso_employee) : ssoOn && e.sso ? ssoOf(base) : 0;
    const wht = l.wht_401 !== '' ? n(l.wht_401) : e.auto_tax && payType === 'monthly' ? taxBreakdown(base, sso > 0).month : 0;
    const add = n(l.ot) + n(l.commission), ded = n(l.absence) + n(l.other_deduct) + sso + wht + n(l.wht_402);
    return { base, sso, wht, add, ded, net: base + add - ded };
  };
  const tot = useMemo(() => rows.reduce((t, l, i) => {
    if (!l.on) return t; const c = calc(emps[i], l);
    return { n: t.n + 1, base: t.base + c.base, add: t.add + c.add, ded: t.ded + c.ded, net: t.net + c.net, cost: t.cost + c.base + c.add + c.sso };
  }, { n: 0, base: 0, add: 0, ded: 0, net: 0, cost: 0 }), [rows]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = () => start(async () => {
    const lines = rows.filter(l => l.on).map(l => {
      const o: Record<string, unknown> = { employee_id: l.employee_id, slip_note: l.slip_note };
      (['days', 'ot', 'commission', 'absence', 'other_deduct', 'sso_employee', 'wht_401', 'wht_402'] as const).forEach(k => { if (l[k] !== '') o[k] = n(l[k]); });
      return o;
    });
    const x = await savePayrollRun(id, { ...h, pay_type: payType, pay_method: method }, lines);
    if (x.error) { setErr(x.error); return; }
    r.push(`/payroll/${id ?? x.id}`); r.refresh();
  });
  const NI = (i: number, k: keyof Line, ph = '') => <input type="number" min="0" step="0.01" style={{ width: 92 }} placeholder={ph} value={rows[i][k] as string} onChange={e => upd(i, k, e.target.value)} />;
  return (
    <>
      <div className="panel">
        <b>{RUN_TYPE[payType]} · จ่าย{PAY_METHOD[method]}</b>
        <div className="grid">
          {([['doc_date', 'วันที่ทำรายการ'], ['period_from', 'ช่วงวันที่'], ['period_to', 'ถึงวันที่'], ['pay_date', 'วันที่ชำระ']] as const).map(([k, l]) =>
            <label key={k} className="f">{l} *<input type="date" value={h[k] ?? ''} onChange={e => setH({ ...h, [k]: e.target.value })} /></label>)}
          <label className="f">หมายเหตุ<input value={h.note ?? ''} onChange={e => setH({ ...h, note: e.target.value })} /></label></div>
      </div>
      <div className="panel wide" style={{ padding: 0, overflowX: 'auto' }}>
        <table><thead><tr><th /><th>พนักงาน</th>{payType === 'daily' && <><th className="num">จำนวนวัน</th><th className="num">ค่าจ้าง/วัน</th></>}
          <th className="num">{payType === 'daily' ? 'ค่าจ้างรวม' : 'เงินเดือน'}</th><th className="num">ค่าล่วงเวลา</th><th className="num">คอมมิชชั่น</th>
          <th className="num">หักขาด/ลา/สาย</th><th className="num">เงินหักอื่น</th><th className="num">ประกันสังคม</th><th className="num">หัก ณ ที่จ่าย 40(1)</th>
          <th className="num">40(2)</th><th className="num">สุทธิ</th><th>หมายเหตุในสลิป</th></tr></thead>
          <tbody>{emps.map((e, i) => { const l = rows[i], c = calc(e, l); return (
            <tr key={e.id} style={{ opacity: l.on ? 1 : .45 }}>
              <td><input type="checkbox" checked={l.on} onChange={x => upd(i, 'on', x.target.checked)} /></td>
              <td>{e.name}<div className="sub">{e.code} · {PAY_METHOD[e.pay_method]}</div></td>
              {payType === 'daily' && <><td className="num">{NI(i, 'days')}</td><td className="num">{m(e.salary)}</td></>}
              <td className="num">{m(c.base)}</td><td className="num">{NI(i, 'ot')}</td><td className="num">{NI(i, 'commission')}</td>
              <td className="num">{NI(i, 'absence')}</td><td className="num">{NI(i, 'other_deduct')}</td>
              <td className="num">{NI(i, 'sso_employee', m(c.sso))}</td><td className="num">{NI(i, 'wht_401', m(c.wht))}</td><td className="num">{NI(i, 'wht_402')}</td>
              <td className="num"><b>{m(c.net)}</b></td>
              <td><input style={{ width: 140 }} value={l.slip_note} onChange={x => upd(i, 'slip_note', x.target.value)} /></td></tr>); })}
            {emps.length === 0 && <tr><td colSpan={14} className="empty">ยังไม่มี{payType === 'daily' ? 'พนักงานรายวัน' : 'พนักงานรายเดือน'} — เพิ่มที่เมนูพนักงาน</td></tr>}</tbody></table>
      </div>
      <div className="panel" style={{ maxWidth: 420 }}>
        <div className="taxbox" style={{ border: 0, padding: 0 }}>
          <div><span>จำนวนพนักงาน</span><b>{tot.n} คน</b></div><div><span>ยอดรวม{RUN_TYPE[payType]}</span><b>{m(tot.base)}</b></div>
          <div><span>รวมรายการปรับเพิ่ม</span><b>{m(tot.add)}</b></div><div><span>รวมรายการปรับลด</span><b>{m(tot.ded)}</b></div>
          <div><span>รวมจ่ายสุทธิ</span><b>{m(tot.net)}</b></div><div><span>รวมค่าใช้จ่ายพนักงาน (รวมสมทบนายจ้าง)</span><b>{m(tot.cost)}</b></div></div>
        <p className="sub">ช่องประกันสังคม/ภาษีที่เว้นว่างจะคำนวณอัตโนมัติ · ภาษีอัตโนมัติคิดจากฐานเงินเดือนเท่านั้น (ถ้ามี OT/คอมมิชชั่นให้กรอกภาษีเอง — ตาม FA)</p>
        {err && <div className="err" role="alert">{err}</div>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" disabled={pending || tot.n === 0} onClick={save}>บันทึก</button>
          <button className="btn ghost" type="button" onClick={() => r.back()}>ปิดหน้าต่าง</button></div>
      </div>
    </>
  );
}
