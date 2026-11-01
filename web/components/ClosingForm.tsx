'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createClosing, updateClosing, approveClosing, deleteClosing } from '@/lib/actions';

/** ปุ่มบันทึก/อนุมัติ/ลบ ของเอกสารปิดบัญชี (ค่าฟอร์มมาจากหน้าจอฝั่งเซิร์ฟเวอร์ที่กดแสดงข้อมูลแล้ว) */
export function ClosingActions({ id, status, vals, canWrite }: { id?: string; status?: 'pending' | 'approved'; vals: { date: string; from: string; to: string; equity: string }; canWrite: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  if (!canWrite) return null;
  const go = (k: string, fn: () => Promise<{ error?: string; id?: string }>, to?: (r: any) => string) => {
    if ((k === 'approve' || k === 'delete') && armed !== k) { setArmed(k); setTimeout(() => setArmed(a => (a === k ? null : a)), 8000); return; }
    setArmed(null); setErr(null);
    start(async () => { const r = await fn(); if (r.error) return setErr(r.error); router.push(to ? to(r) : '/settings/close-year'); router.refresh(); });
  };
  const B = ({ k, label, ghost = false, danger = false, run, to }: { k: string; label: string; ghost?: boolean; danger?: boolean; run: () => Promise<any>; to?: (r: any) => string }) =>
    <button className={`btn${ghost ? ' ghost' : ''}${danger ? ' danger' : ''}`} disabled={pending} onClick={() => go(k, run, to)}>{pending ? '...' : armed === k ? 'กดอีกครั้งเพื่อยืนยัน' : label}</button>;
  return (
    <div className="noprint" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      {err && <span className="toast" role="alert" onClick={() => setErr(null)}>{err}</span>}
      {status === 'approved' && id && <B k="delete" label="ลบ (กลับรายการ)" ghost danger run={() => deleteClosing(id)} />}
      {status === 'pending' && id && <>
        <B k="delete" label="ลบ" ghost danger run={() => deleteClosing(id)} />
        <B k="save" label="บันทึกร่าง" ghost run={() => updateClosing(id, vals)} />
        <B k="approve" label="อนุมัติปิดบัญชี" run={async () => { const u = await updateClosing(id, vals); return u.error ? u : approveClosing(id); }} /></>}
      {!id && <>
        <B k="draft" label="บันทึกร่าง" ghost run={() => createClosing({ ...vals, approve: false })} to={r => `/settings/close-year/${r.id}`} />
        <B k="approve" label="อนุมัติปิดบัญชี" run={() => createClosing({ ...vals, approve: true })} to={r => `/settings/close-year/${r.id}`} /></>}
    </div>
  );
}
