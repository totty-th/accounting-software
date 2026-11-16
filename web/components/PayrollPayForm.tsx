'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { payPayrollRun } from '@/lib/actions';

/** บันทึกการจ่ายเงินเดือน: วันที่ชำระ + ค่าธรรมเนียมโอน (เฉพาะโอนเงิน) */
export function PayrollPayForm({ id, date, method, net, bank }: { id: string; date: string; method: string; net: string; bank: string | null }) {
  const r = useRouter();
  const [d, setD] = useState(date), [fee, setFee] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const go = () => start(async () => { const x = await payPayrollRun(id, d, Number(fee) || 0); if (x.error) setErr(x.error); else { setErr(null); r.refresh(); } });
  return (
    <div className="panel">
      <b>บันทึกการจ่ายเงินเดือน</b> <span className="sub">ยอดจ่ายสุทธิ {net} · {method === 'cash' ? 'จ่ายเงินสด (11112)' : `โอนจาก ${bank ?? '— ยังไม่ได้ตั้งบัญชีเงินเดือน'}`}</span>
      <div className="grid">
        <label className="f">วันที่ชำระ<input type="date" value={d} onChange={e => setD(e.target.value)} /></label>
        {method === 'transfer' && <label className="f">ค่าธรรมเนียม<input type="number" min="0" step="0.01" value={fee} onChange={e => setFee(e.target.value)} /></label>}</div>
      {err && <div className="err" role="alert">{err}</div>}
      <button className="btn" disabled={pending || !d} onClick={go}>ยืนยันการจ่ายเงินเดือน</button>
    </div>
  );
}
