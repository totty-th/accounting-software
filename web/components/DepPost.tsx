'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { postAssetDepreciation } from '@/lib/actions';

export function PostDepButton({ year }: { year: number }) {
  const router = useRouter(); const [pending, start] = useTransition(); const [msg, setMsg] = useState<string | null>(null); const [err, setErr] = useState(false);
  return <>
    <button className="btn sm" disabled={pending} onClick={() => start(async () => {
      const r = await postAssetDepreciation(year);
      setErr(!!r.error); setMsg(r.error ?? (r.n ? `บันทึกบัญชีค่าเสื่อมราคา ${r.n} เดือนแล้ว` : 'ยอดตรงกับที่บันทึกไว้แล้ว ไม่มีรายการใหม่'));
      if (!r.error) router.refresh(); })}>{pending ? '...' : 'บันทึกบัญชีค่าเสื่อมราคา'}</button>
    {msg && <span className="sub" role="status" style={{ color: err ? 'var(--red)' : undefined }}>{msg}</span>}</>;
}
