'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { filePp30, payPp30 } from '@/lib/actions';

/** สร้างแบบ ภ.พ.30 ของเดือนที่เลือก (ย้ายภาษีซื้อ + หักกลบภาษีขาย ลงวันสิ้นเดือน) */
export function Pp30Create({ defaultMonth }: { defaultMonth: string }) {
  const r = useRouter(); const [m, setM] = useState(defaultMonth); const [err, setErr] = useState<string | null>(null); const [p, start] = useTransition();
  return (
    <div className="panel"><b>เตรียมแบบ ภ.พ.30</b>
      <div style={{ display: 'flex', gap: 10, alignItems: 'end', flexWrap: 'wrap' }}>
        <label className="f">เดือนภาษี<input type="month" value={m} onChange={e => setM(e.target.value)} /></label>
        <button className="btn" disabled={p || !m} onClick={() => start(async () => { const x = await filePp30(m); if (x.error) setErr(x.error); else { setErr(null); r.refresh(); } })}>สร้างแบบ</button></div>
      {err && <div className="err" role="alert">{err}</div>}</div>
  );
}
export function Pp30Pay({ id, accounts, defaultDate }: { id: string; accounts: { code: string; name: string }[]; defaultDate: string }) {
  const r = useRouter(); const [open, setOpen] = useState(false); const [d, setD] = useState(defaultDate); const [a, setA] = useState(accounts[0]?.code ?? '');
  const [err, setErr] = useState<string | null>(null); const [p, start] = useTransition();
  if (!open) return <button className="btn sm" onClick={() => setOpen(true)}>บันทึกชำระ</button>;
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      <input type="date" value={d} onChange={e => setD(e.target.value)} aria-label="วันที่ชำระ" />
      <select value={a} onChange={e => setA(e.target.value)} aria-label="ชำระจากบัญชี">{accounts.map(x => <option key={x.code} value={x.code}>{x.code} {x.name}</option>)}</select>
      <button className="btn sm" disabled={p} onClick={() => start(async () => { const x = await payPp30(id, d, a); if (x.error) setErr(x.error); else { setErr(null); setOpen(false); r.refresh(); } })}>ยืนยัน</button>
      <button className="btn sm ghost" onClick={() => setOpen(false)}>ยกเลิก</button>
      {err && <span className="err" role="alert">{err}</span>}</div>
  );
}
