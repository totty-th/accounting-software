'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { addSlipDoc, removeSlipDoc, renamePaymentSlip } from '@/lib/actions';

/** เพิ่ม/ลบเอกสารในใบเตรียมจ่ายหลังบันทึก (เฉพาะรอดำเนินการ) */
export function SlipDocs({ id, cands }: { id: string; cands: { key: string; label: string }[] }) {
  const router = useRouter(); const [pending, start] = useTransition(); const [err, setErr] = useState<string | null>(null); const [sel, setSel] = useState('');
  const add = () => start(async () => { const [t, d] = sel.split(':'); const r = await addSlipDoc(id, t, d); if (r.error) setErr(r.error); else { setErr(null); setSel(''); router.refresh(); } });
  return <div className="acts" style={{ justifyContent: 'flex-start', gap: 8, marginTop: 8 }}>
    <select value={sel} onChange={e => setSel(e.target.value)} style={{ width: 'auto' }} aria-label="เพิ่มรายการเอกสาร">
      <option value="">+ เพิ่มรายการเอกสาร</option>{cands.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}</select>
    <button type="button" className="btn sm" disabled={pending || !sel} onClick={add}>เพิ่ม</button>
    {err && <span className="sub" role="alert" style={{ color: 'var(--bad, #c0392b)' }}>{err}</span>}</div>;
}
export function SlipRemove({ id, line }: { id: string; line: number }) {
  const router = useRouter(); const [pending, start] = useTransition(); const [err, setErr] = useState<string | null>(null);
  return <><button type="button" className="btn sm ghost" disabled={pending} title="ลบรายการ" aria-label="ลบรายการ"
    onClick={() => start(async () => { const r = await removeSlipDoc(id, line); if (r.error) setErr(r.error); else router.refresh(); })}>🗑</button>
    {err && <div className="toast" role="alert" onClick={() => setErr(null)}>{err}</div>}</>;
}
export function SlipRename({ id, no }: { id: string; no: string }) {
  const router = useRouter(); const [pending, start] = useTransition(); const [v, setV] = useState(no); const [open, setOpen] = useState(false); const [err, setErr] = useState<string | null>(null);
  if (!open) return <button type="button" className="btn sm ghost" title="แก้ไขเลขที่เอกสาร" aria-label="แก้ไขเลขที่เอกสาร" onClick={() => setOpen(true)}>✎</button>;
  return <span className="acts" style={{ gap: 6 }}><input value={v} onChange={e => setV(e.target.value)} style={{ width: 170 }} aria-label="เลขที่เอกสาร" />
    <button type="button" className="btn sm" disabled={pending} onClick={() => start(async () => { const r = await renamePaymentSlip(id, v); if (r.error) setErr(r.error); else { setErr(null); setOpen(false); router.refresh(); } })}>บันทึก</button>
    <button type="button" className="btn sm ghost" onClick={() => { setOpen(false); setV(no); setErr(null); }}>ยกเลิก</button>
    {err && <span className="sub" role="alert">{err}</span>}</span>;
}
