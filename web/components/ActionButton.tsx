'use client';
import { useState, useTransition } from 'react';

type Result = { error?: string; ok?: true };
export function ActionButton({ action, label, variant = '', confirmText }:
  { action: () => Promise<Result>; label: string; variant?: '' | 'ghost' | 'danger'; confirmText?: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);
  const fire = () => start(async () => {
    const r = await action();
    setArmed(false);
    setMsg(r.error ?? null);
    if (r.error) setTimeout(() => setMsg(null), 7000);
  });
  return (
    <>
      <button className={`btn sm ${variant}`} disabled={pending}
        onClick={() => (confirmText && !armed ? (setArmed(true), setTimeout(() => setArmed(false), 4000)) : fire())}>
        {pending ? '...' : armed ? 'กดอีกครั้งเพื่อยืนยัน' : label}
      </button>
      {armed && confirmText && confirmText.length > 1 && <div className="toast" role="alert">{confirmText}</div>}
      {msg && <div className="toast" role="alert" onClick={() => setMsg(null)}>{msg}</div>}
    </>
  );
}
