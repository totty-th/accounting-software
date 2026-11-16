'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { saveMyProfile } from '@/lib/user-actions';

export function ProfileForm({ first, last, phone }: { first: string; last: string; phone: string }) {
  const router = useRouter(); const [pending, start] = useTransition();
  const [f, setF] = useState({ first, last, phone }); const [msg, setMsg] = useState<{ t: string; ok: boolean } | null>(null);
  return (
    <div className="panel" style={{ display: 'grid', gap: 10, padding: 16, maxWidth: 520 }}>
      <label className="f">ชื่อจริง<input value={f.first} onChange={e => setF({ ...f, first: e.target.value })} /></label>
      <label className="f">นามสกุล<input value={f.last} onChange={e => setF({ ...f, last: e.target.value })} /></label>
      <label className="f">เบอร์โทร<input inputMode="tel" value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} /></label>
      {msg && <div className="notice" role="alert" style={{ borderLeftColor: msg.ok ? 'var(--green)' : 'var(--red)' }}>{msg.t}</div>}
      <div><button className="btn" disabled={pending || !f.first.trim()}
        onClick={() => start(async () => { const r = await saveMyProfile(f); setMsg(r.error ? { t: r.error, ok: false } : { t: 'บันทึกแล้ว', ok: true }); if (!r.error) router.refresh(); })}>บันทึก</button></div>
    </div>
  );
}
