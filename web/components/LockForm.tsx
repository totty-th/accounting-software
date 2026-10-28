'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { lockPeriod } from '@/lib/actions';

export function LockForm({ maxTo }: { maxTo: string }) {
  const r = useRouter();
  const [f, setF] = useState({ from: '', to: '', reason: '' });
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const go = () => start(async () => { const x = await lockPeriod(f.from, f.to, f.reason); if (x.error) setErr(x.error); else { setErr(null); setF({ from: '', to: '', reason: '' }); r.refresh(); } });
  return (
    <div className="panel">
      <b>ล็อกงวดบัญชี</b> <span className="sub">ล็อกได้ถึงเมื่อวาน ({maxTo}) · เอกสาร/ใบสำคัญที่ลงวันที่ในช่วงที่ล็อกจะบันทึกหรือแก้ไม่ได้</span>
      <div className="grid">
        <label className="f">ตั้งแต่ *<input type="date" value={f.from} onChange={e => setF({ ...f, from: e.target.value })} /></label>
        <label className="f">ถึง *<input type="date" max={maxTo} value={f.to} onChange={e => setF({ ...f, to: e.target.value })} /></label>
        <label className="f">เหตุผล *<input value={f.reason} onChange={e => setF({ ...f, reason: e.target.value })} placeholder="เช่น ปิดงบประจำเดือน ก.ย." /></label></div>
      {err && <div className="err" role="alert">{err}</div>}
      <button className="btn" disabled={pending || !f.from || !f.to || !f.reason.trim()} onClick={go}>ล็อกงวด</button>
    </div>
  );
}
