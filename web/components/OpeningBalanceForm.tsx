'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { saveOpeningBalance } from '@/lib/actions';

type A = { code: string; name: string; debit: string; credit: string };
const num = (s: string) => Number(s) || 0;
const fmt = (n: number) => n.toLocaleString('th-TH', { minimumFractionDigits: 2 });
/** ตั้งค่ายอดเริ่มต้น: กรอกเดบิต/เครดิตต่อบัญชีงบฐานะการเงิน · เดบิตรวมต้องเท่าเครดิตรวม */
export function OpeningBalanceForm({ date, rows }: { date: string; rows: A[] }) {
  const r = useRouter();
  const [d, setD] = useState(date);
  const [ls, setLs] = useState(rows);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [pending, start] = useTransition();
  const upd = (i: number, k: 'debit' | 'credit', v: string) => setLs(x => x.map((l, j) => (j !== i ? l : { ...l, [k]: v, ...(k === 'debit' && v ? { credit: '' } : {}), ...(k === 'credit' && v ? { debit: '' } : {}) })));
  const dr = ls.reduce((s, l) => s + num(l.debit), 0), cr = ls.reduce((s, l) => s + num(l.credit), 0), diff = Math.round((dr - cr) * 100) / 100;
  const save = () => start(async () => {
    setOk(false);
    const x = await saveOpeningBalance(d, ls.filter(l => num(l.debit) || num(l.credit)).map(l => ({ account: l.code, debit: num(l.debit) || undefined, credit: num(l.credit) || undefined })));
    if (x.error) setErr(x.error); else { setErr(null); setOk(true); r.refresh(); }
  });
  return (
    <>
      <div className="panel"><label className="f">วันที่เริ่มต้นใช้ระบบ (ยอดยกมา ณ วันนี้)<input type="date" value={d} onChange={e => setD(e.target.value)} /></label></div>
      <div className="panel" style={{ padding: 0, overflowX: 'auto' }}>
        <table><thead><tr><th>รหัส</th><th>ชื่อบัญชี</th><th className="num" style={{ width: 150 }}>เดบิต</th><th className="num" style={{ width: 150 }}>เครดิต</th></tr></thead>
          <tbody>{ls.map((l, i) => <tr key={l.code}><td className="no">{l.code}</td><td>{l.name}</td>
            <td><input type="number" min="0" step="0.01" aria-label={`เดบิต ${l.code}`} value={l.debit} onChange={e => upd(i, 'debit', e.target.value)} style={{ width: '100%', textAlign: 'right' }} /></td>
            <td><input type="number" min="0" step="0.01" aria-label={`เครดิต ${l.code}`} value={l.credit} onChange={e => upd(i, 'credit', e.target.value)} style={{ width: '100%', textAlign: 'right' }} /></td></tr>)}
            <tr style={{ fontWeight: 700 }}><td /><td>รวม {diff !== 0 && <span style={{ color: 'var(--red)', fontWeight: 400 }}> · ผลต่าง {fmt(diff)}</span>}</td><td className="num">{fmt(dr)}</td><td className="num">{fmt(cr)}</td></tr></tbody></table>
      </div>
      {err && <div className="err" role="alert">{err}</div>}{ok && <div className="ok" role="status">บันทึกยอดเริ่มต้นแล้ว</div>}
      <div style={{ marginTop: 10 }}><button className="btn" disabled={pending || diff !== 0} onClick={save}>บันทึกยอดเริ่มต้น</button>
        <span className="sub" style={{ marginLeft: 10 }}>บันทึกซ้ำ = แทนที่ยอดเริ่มต้นเดิม (ใบเดิมถูกกลับรายการ -R) · เว้นว่างทั้งหมด = ล้างยอดเริ่มต้น</span></div>
    </>
  );
}
