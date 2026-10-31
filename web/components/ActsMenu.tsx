'use client';
import { useState } from 'react';

/** กลุ่มปุ่มการกระทำ: จอกว้าง = เรียงเป็นปุ่ม (dropdown=true → เป็นเมนูลงทุกขนาดจอ) · มือถือ = ยุบเป็นปุ่ม "การกระทำ ▾" เปิดรายการลงมา */
export function ActsMenu({ children, label = 'การกระทำ', dropdown = false }: { children: React.ReactNode; label?: string; dropdown?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`acts am ${dropdown ? 'dd' : ''} ${open ? 'open' : ''}`}>
      <button type="button" className="btn ghost am-btn" aria-expanded={open} onClick={() => setOpen(o => !o)}>{label} ▾</button>
      {open && <div className="am-back" onClick={() => setOpen(false)} />}
      <div className="am-list" onClick={e => { if ((e.target as HTMLElement).closest('a')) setOpen(false); }}>{children}</div>
    </div>
  );
}
