'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { SLIP_TH, SLIP_COLOR, type SlipState } from '@/lib/slip-state';
import { cancelPaymentSlip, receivePaymentSlip, resetPaymentSlip, deletePaymentSlip } from '@/lib/actions';


/** สถานะแบบดรอปดาวน์ตามต้นแบบ: รอดำเนินการ→ชำระเงิน|ยกเลิก · ชำระเงินแล้ว→รับใบเสร็จแล้ว|แก้ไขข้อมูลการชำระ|รีเซ็ต · รับใบเสร็จแล้ว→แก้ไขข้อมูลการชำระ|รีเซ็ต · ยกเลิก→(ไม่มี) */
export function SlipStatus({ id, state, canWrite }: { id: string; state: SlipState; canWrite: boolean }) {
  const router = useRouter(); const [pending, start] = useTransition(); const [err, setErr] = useState<string | null>(null);
  const opts: [string, string][] = state === 'pending' ? [['pay', 'ชำระเงิน'], ['cancel', 'ยกเลิก']]
    : state === 'paid' ? [['receive', 'รับใบเสร็จแล้ว'], ['edit', 'แก้ไขข้อมูลการชำระ'], ['reset', 'รีเซ็ต']]
    : state === 'received' ? [['edit', 'แก้ไขข้อมูลการชำระ'], ['reset', 'รีเซ็ต']] : [];
  const go = (v: string) => {
    if (v === 'pay' || v === 'edit') { router.push(`/payments/${id}#pay`); return; }
    start(async () => {
      const r = await (v === 'cancel' ? cancelPaymentSlip(id) : v === 'receive' ? receivePaymentSlip(id) : resetPaymentSlip(id));
      if (r.error) setErr(r.error); else { setErr(null); router.refresh(); }
    });
  };
  const color = SLIP_COLOR[state];
  if (!canWrite || opts.length === 0) return <span style={{ color }}>{SLIP_TH[state]}</span>;
  return <>
    <select value="" disabled={pending} onChange={e => e.target.value && go(e.target.value)} style={{ width: 'auto', color }} aria-label="เปลี่ยนสถานะ">
      <option value="">{SLIP_TH[state]}</option>{opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
    {err && <div className="toast" role="alert" onClick={() => setErr(null)}>{err}</div>}
  </>;
}

/** ปุ่มลบ (เฉพาะรอดำเนินการ/ยกเลิก) — ต้นแบบถามยืนยัน "คุณกำลังลบข้อมูล ต้องการดำเนินการต่อหรือไม่?" */
export function SlipDelete({ id }: { id: string }) {
  const router = useRouter(); const [pending, start] = useTransition(); const [err, setErr] = useState<string | null>(null);
  const del = () => {
    if (!window.confirm('คุณกำลังลบข้อมูล ต้องการดำเนินการต่อหรือไม่?')) return;
    start(async () => { const r = await deletePaymentSlip(id); if (r.error) setErr(r.error); else router.refresh(); });
  };
  return <><button type="button" className="btn sm ghost" disabled={pending} onClick={del}>ลบ</button>
    {err && <div className="toast" role="alert" onClick={() => setErr(null)}>{err}</div>}</>;
}
