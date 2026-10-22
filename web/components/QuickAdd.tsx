'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

type Result = { error?: string; ok?: true };
export function QuickAdd({ fields, action, label }: {
  fields: { name: string; label: string; type?: 'text' | 'number' | 'select'; options?: [string, string][]; required?: boolean }[];
  action: (p: any) => Promise<Result>; label: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!open) return <button className="btn" onClick={() => setOpen(true)}>+ {label}</button>;
  const go = () => start(async () => {
    const p: any = {}; for (const f of fields) p[f.name] = f.type === 'number' ? Number(v[f.name] || 0) : (v[f.name] ?? (f.options?.[0]?.[0] ?? ''));
    const r = await action(p);
    if (r.error) return setErr(r.error);
    setOpen(false); setV({}); setErr(null); router.refresh();
  });
  return (
    <div className="panel" style={{ marginBottom: 16, flexBasis: '100%' }}>
      <div className="grid">
        {fields.map(f => (
          <label className="f" key={f.name}>{f.label}
            {f.type === 'select'
              ? <select value={v[f.name] ?? f.options![0][0]} onChange={e => setV({ ...v, [f.name]: e.target.value })}>{f.options!.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
              : <input type={f.type === 'number' ? 'number' : 'text'} value={v[f.name] ?? ''} onChange={e => setV({ ...v, [f.name]: e.target.value })} />}
          </label>))}
      </div>
      {err && <div className="notice" role="alert" style={{ borderLeftColor: 'var(--red)' }}>{err}</div>}
      <button className="btn" disabled={pending} onClick={go}>{pending ? 'กำลังบันทึก...' : 'บันทึก'}</button>{' '}
      <button className="btn ghost" onClick={() => setOpen(false)}>ปิด</button>
    </div>
  );
}
