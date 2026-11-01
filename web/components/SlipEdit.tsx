'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { updatePaymentSlip } from '@/lib/actions';

export function SlipEdit({ id, init, disabled }: { id: string; init: { due: string; preparer: string; requester: string; approver: string; reason: string; note: string; internal: string }; disabled: boolean }) {
  const router = useRouter(); const [v, setV] = useState(init); const [msg, setMsg] = useState<string | null>(null); const [pending, start] = useTransition();
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV(o => ({ ...o, [k]: e.target.value }));
  const same = JSON.stringify(v) === JSON.stringify(init);
  const save = () => start(async () => {
    if (same) { setMsg('ไม่พบการเปลี่ยนแปลงข้อมูลในเอกสาร'); return; }
    const r = await updatePaymentSlip(id, v); setMsg(r.error ?? 'บันทึกข้อมูลสำเร็จ'); if (!r.error) router.refresh();
  });
  return (
    <div className="panel">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 6 }}>
        <label>ชำระภายในวันที่<input type="date" value={v.due} onChange={set('due')} disabled={disabled} /></label>
        <label>ผู้จัดเตรียม<input value={v.preparer} onChange={set('preparer')} disabled={disabled} /></label>
        <label>ผู้ขอ<input value={v.requester} onChange={set('requester')} disabled={disabled} /></label>
        <label>ผู้อนุมัติ<input value={v.approver} onChange={set('approver')} disabled={disabled} /></label>
        <label style={{ gridColumn: '1 / -1' }}>สาเหตุที่ขอ<input value={v.reason} onChange={set('reason')} disabled={disabled} /></label>
        <label>หมายเหตุ<textarea value={v.note} onChange={set('note')} disabled={disabled} /></label>
        <label>โน้ตภายในบริษัท<textarea value={v.internal} onChange={set('internal')} disabled={disabled} /></label>
      </div>
      {!disabled && <div className="acts" style={{ justifyContent: 'flex-start', gap: 8, marginTop: 8 }}>
        <button type="button" className="btn sm" disabled={pending} onClick={save}>{pending ? '...' : 'บันทึกเอกสาร'}</button>
        {msg && <span className="sub" role="status">{msg}</span>}</div>}
    </div>
  );
}
