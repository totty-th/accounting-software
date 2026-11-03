'use client';
import { useState, useTransition } from 'react';

/** ฟอร์มตั้งค่า: เรียก server action แล้วแสดงผลสำเร็จ/ข้อผิดพลาดบนหน้า (action คืน {error?}) */
export function SForm({ action, children, label = 'บันทึก', className = 'panel', style, canWrite = true, danger }: {
  action: (f: FormData) => Promise<{ error?: string; ok?: true }>; children: React.ReactNode; label?: string;
  className?: string; style?: React.CSSProperties; canWrite?: boolean; danger?: boolean;
}) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  return (
    <form className={className} style={{ display: 'grid', gap: 10, padding: 16, ...style }}
      onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); setMsg(null);
        start(async () => { const r = await action(f); setMsg(r.error ? { ok: false, t: r.error } : { ok: true, t: 'บันทึกแล้ว' }); }); }}>
      <fieldset disabled={!canWrite || pending} style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 10 }}>{children}</fieldset>
      {msg && <div className="notice" role={msg.ok ? 'status' : 'alert'} style={msg.ok ? undefined : { borderLeftColor: 'var(--red)' }}>{msg.t}</div>}
      {canWrite && <button className={`btn${danger ? ' ghost' : ''}`} disabled={pending}>{pending ? 'กำลังบันทึก...' : label}</button>}
    </form>
  );
}
