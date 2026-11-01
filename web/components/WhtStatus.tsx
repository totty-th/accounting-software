'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { cancelWhtCert, resetWhtCert, activateWhtCert } from '@/lib/actions';

const TH: Record<string, string> = { active: 'ดำเนินการแล้ว', pending: 'รอดำเนินการ', cancelled: 'ยกเลิก' };
/** สถานะแบบดรอปดาวน์ตามต้นแบบ: ดำเนินการแล้ว→ยกเลิก|รีเซ็ต · ยกเลิก→รีเซ็ต · รอดำเนินการ→ดำเนินการแล้ว */
export function WhtStatus({ id, status, linked, canWrite }: { id: string; status: string; linked: boolean; canWrite: boolean }) {
  const router = useRouter(); const [pending, start] = useTransition(); const [err, setErr] = useState<string | null>(null);
  const opts: [string, string][] = linked ? [] : status === 'active' ? [['cancel', 'ยกเลิก'], ['reset', 'รีเซ็ต']] : status === 'cancelled' ? [['reset', 'รีเซ็ต']] : [['activate', 'ดำเนินการแล้ว']];
  const go = (v: string) => start(async () => {
    const r = await (v === 'cancel' ? cancelWhtCert(id) : v === 'reset' ? resetWhtCert(id) : activateWhtCert(id));
    if (r.error) setErr(r.error); else { setErr(null); router.refresh(); }
  });
  const color = status === 'active' ? 'var(--green)' : status === 'cancelled' ? 'var(--red, #c0392b)' : 'var(--grey)';
  if (!canWrite || opts.length === 0) return <span style={{ color }}>{TH[status]}</span>;
  return <>
    <select value="" disabled={pending} onChange={e => e.target.value && go(e.target.value)} style={{ width: 'auto', color }} aria-label="เปลี่ยนสถานะ">
      <option value="">{TH[status]}</option>{opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
    {err && <div className="toast" role="alert" onClick={() => setErr(null)}>{err}</div>}
  </>;
}
