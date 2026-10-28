'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { suggestProducts } from '@/lib/actions';
import { qty } from '@/lib/format';

type S = Awaited<ReturnType<typeof suggestProducts>>;
/** ช่องค้นหาแบบแนะนำ (แบบ FA): พิมพ์แล้วขึ้นรายการ ชื่อ/รหัส/บาร์โค้ด + คงเหลือ · เลือกแล้วกรองตารางเหลือรายการนั้น · ไม่พบ = "ไม่พบข้อมูลที่คุณกำลังค้นหา" */
export function ProductSearch({ q, base }: { q: string; base: Record<string, string> }) {
  const r = useRouter();
  const [v, setV] = useState(q);
  const [list, setList] = useState<S | null>(null);
  const [open, setOpen] = useState(false);
  const seq = useRef(0);
  useEffect(() => {
    if (!v.trim()) { setList(null); return; }
    const my = ++seq.current;
    const t = setTimeout(async () => { const x = await suggestProducts(v, base.wh ?? ''); if (my === seq.current) setList(x); }, 200);
    return () => clearTimeout(t);
  }, [v, base.wh]);
  const go = (text: string) => { const u = new URLSearchParams(base); if (text) u.set('q', text); setOpen(false); r.push(`/products?${u}`); };
  return (
    <div style={{ position: 'relative', flex: 1, minWidth: 240 }}>
      <form role="search" onSubmit={e => { e.preventDefault(); go(v.trim()); }} style={{ display: 'flex', gap: 4 }}>
        <input aria-label="ค้นหาสินค้า" value={v} onChange={e => { setV(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} placeholder="ค้นหาจาก ชื่อ, รหัสสินค้า หรือบาร์โค้ด" style={{ flex: 1 }} />
        {(v || q) && <button type="button" className="btn sm ghost" aria-label="ล้างคำค้น" onClick={() => { setV(''); go(''); }}>✕</button>}
      </form>
      {open && v.trim() && list && <>
        <div style={{ position: 'fixed', inset: 0, zIndex: 20 }} onClick={() => setOpen(false)} />
        <div role="listbox" className="panel" style={{ position: 'absolute', zIndex: 21, left: 0, right: 0, top: '100%', padding: 4, maxHeight: 320, overflowY: 'auto' }}>
          {list.length === 0 ? <div className="sub" style={{ padding: 8 }}>ไม่พบข้อมูลที่คุณกำลังค้นหา</div> :
            list.map(s => <button key={s.id} role="option" aria-selected="false" type="button" className="btn ghost" style={{ display: 'flex', width: '100%', justifyContent: 'space-between', textAlign: 'left', gap: 8 }} onClick={() => go(s.code || s.name)}>
              <span><b>{s.name}</b><div className="sub">รหัสสินค้า: {s.code}</div></span>{s.onhand != null && <span className="sub">คงเหลือ {qty(s.onhand)} {s.unit}</span>}</button>)}</div></>}
    </div>
  );
}
