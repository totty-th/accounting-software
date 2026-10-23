'use client';
import { useState } from 'react';

export function PrintButton() {
  return <button className="btn ghost" type="button" onClick={() => window.print()}>พิมพ์</button>;
}

export function CopyBox({ text, label = 'คัดลอก' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <span className="copybox">
      <input readOnly value={text} onFocus={e => e.currentTarget.select()} />
      <button className="btn sm" type="button" onClick={async () => {
        try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* เลือกข้อความเอง */ }
      }}>{done ? 'คัดลอกแล้ว' : label}</button>
    </span>
  );
}
