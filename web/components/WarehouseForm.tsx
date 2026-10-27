'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { saveWarehouse } from '@/lib/actions';
import { PURPOSE } from '@/lib/stock-labels';

type W = { id?: string; name: string; code: string; purpose: string; address: string; postal: string; contact: string; email: string; phone: string; low: string };
export const EMPTY_WH: W = { name: '', code: '', purpose: '', address: '', postal: '', contact: '', email: '', phone: '', low: '' };
export function WarehouseForm({ init, label }: { init?: W; label: string }) {
  const r = useRouter();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<W>(init ?? EMPTY_WH);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (k: keyof W, v: string) => setF(p => ({ ...p, [k]: v }));
  if (!open) return <button className={init ? 'btn sm ghost' : 'btn'} onClick={() => setOpen(true)}>{label}</button>;
  const save = () => start(async () => {
    const res = await saveWarehouse({ ...f, low: f.low === '' ? null : Number(f.low) });
    if (res.error) setErr(res.error); else { setOpen(false); setErr(null); r.refresh(); }
  });
  return (
    <div className="panel" style={{ flexBasis: '100%', maxWidth: 560 }}>
      <h3>{init ? 'แก้ไขคลังสินค้า' : 'สร้างคลังสินค้า'}</h3>
      <div className="grid">
        <label className="f">ชื่อคลังสินค้า *<input value={f.name} onChange={e => set('name', e.target.value)} /></label>
        <label className="f">รหัสคลังสินค้า<input value={f.code} onChange={e => set('code', e.target.value)} /></label>
        <label className="f">จุดประสงค์การใช้งาน *<select value={f.purpose} onChange={e => set('purpose', e.target.value)}><option value="">เลือก</option>{PURPOSE.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className="f">รหัสไปรษณีย์<input value={f.postal} onChange={e => set('postal', e.target.value)} /></label>
        <label className="f">ที่อยู่<textarea value={f.address} onChange={e => set('address', e.target.value)} /></label>
        <label className="f">ชื่อผู้ติดต่อ/ผู้ดูแล<input value={f.contact} onChange={e => set('contact', e.target.value)} /></label>
        <label className="f">อีเมล<input value={f.email} onChange={e => set('email', e.target.value)} /></label>
        <label className="f">เบอร์โทรศัพท์<input value={f.phone} onChange={e => set('phone', e.target.value)} /></label>
        <label className="f">จำนวนขั้นต่ำ (สินค้าใกล้หมด · เว้นว่าง = ไม่แจ้งเตือน)<input type="number" min="0" value={f.low} onChange={e => set('low', e.target.value)} /></label>
      </div>
      {err && <div className="notice" role="alert" style={{ borderLeftColor: 'var(--red)' }}>{err}</div>}
      <button className="btn" disabled={pending} onClick={save}>บันทึก</button>{' '}<button className="btn ghost" onClick={() => setOpen(false)}>ยกเลิก</button>
    </div>
  );
}
