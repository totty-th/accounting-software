'use client';
import { useRef, useState } from 'react';

/** กลุ่มปุ่มการกระทำ: จอกว้าง = เรียงเป็นปุ่ม (dropdown=true → เป็นเมนูลงทุกขนาดจอ) · มือถือ = ยุบเป็นปุ่ม "การกระทำ ▾" เปิดรายการลงมา */
export function ActsMenu({ children, label = 'การกระทำ', dropdown = false, float = false }: { children: React.ReactNode; label?: string; dropdown?: boolean; float?: boolean }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<React.CSSProperties | undefined>();
  const btn = useRef<HTMLButtonElement>(null);
  // float = ใช้ในตารางที่มี overflow: ลอยเมนูแบบ fixed ตามตำแหน่งปุ่ม (ไม่ถูกตัดขอบตาราง) และกลับด้านเมื่อใกล้ขอบล่าง
  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!open && float && btn.current) {
      const r = btn.current.getBoundingClientRect(), up = window.innerHeight - r.bottom < 300 && r.top > 300;
      setPos({ position: 'fixed', right: Math.max(8, window.innerWidth - r.right), left: 'auto', top: up ? 'auto' : r.bottom + 6, bottom: up ? window.innerHeight - r.top + 6 : 'auto' });
    }
    setOpen(o => !o);
  };
  return (
    <div className={`acts am ${dropdown || float ? 'dd' : ''} ${open ? 'open' : ''}`} onClick={float ? e => e.stopPropagation() : undefined}>
      <button ref={btn} type="button" className="btn ghost am-btn" aria-expanded={open} onClick={toggle}>{label} ▾</button>
      {open && <div className="am-back" onClick={() => setOpen(false)} />}
      <div className="am-list" style={float && open ? pos : undefined} onClick={e => { if ((e.target as HTMLElement).closest('a')) setOpen(false); }}>{children}</div>
    </div>
  );
}
