'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { adjustStock } from '@/lib/actions';
import { ADJ_IN, ADJ_OUT } from '@/lib/stock-labels';

// ปรับยอดคงคลัง (ไม่ลงบัญชี ตาม FA): คลัง* · เพิ่ม/ลด · สาเหตุ · จำนวน · ต้นทุน (เฉพาะเพิ่ม) · หมายเหตุ
export function StockAdjustDialog({ product, unit, today, whs, onhand }: { product: string; unit: string; today: string; whs: { id: string; name: string; qty: number }[]; onhand: number }) {
  const r = useRouter();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ date: today, wh: '', dir: 'in' as 'in' | 'out', reason: '', qty: '', cost: '', note: '' });
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!open) return <button className="btn ghost" onClick={() => setOpen(true)}>ปรับยอดคงคลัง</button>;
  const cur = whs.find(w => w.id === f.wh)?.qty ?? 0, q = Number(f.qty) || 0;
  const after = f.wh ? cur + (f.dir === 'in' ? q : -q) : null;
  const reasons = f.dir === 'in' ? ADJ_IN : ADJ_OUT;
  const save = () => start(async () => {
    const res = await adjustStock({ product, date: f.date, wh: f.wh, dir: f.dir, reason: f.reason, qty: q, cost: f.dir === 'in' && f.cost !== '' ? Number(f.cost) : null, note: f.note });
    if (res.error) setErr(res.error); else { setOpen(false); setErr(null); setF({ ...f, qty: '', cost: '', note: '', reason: '' }); r.refresh(); }
  });
  return (
    <div className="panel" style={{ flexBasis: '100%', maxWidth: 520 }}>
      <h3>ปรับยอดคงคลัง</h3>
      <div className="grid">
        <label className="f">วันที่ปรับยอด<input type="date" value={f.date} onChange={e => setF({ ...f, date: e.target.value })} /></label>
        <label className="f">คลังสินค้า *<select value={f.wh} onChange={e => setF({ ...f, wh: e.target.value })}><option value="">เลือกคลังสินค้า</option>{whs.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
        <label className="f">รายการปรับปรุง<select value={f.dir} onChange={e => setF({ ...f, dir: e.target.value as any, reason: '' })}><option value="in">ปรับเพิ่ม</option><option value="out">ปรับลด</option></select></label>
        <label className="f">สาเหตุ *<select value={f.reason} onChange={e => setF({ ...f, reason: e.target.value })}><option value="">-- กรุณาเลือก --</option>{reasons.map(x => <option key={x}>{x}</option>)}</select></label>
        <label className="f">จำนวนคงเหลือ<input readOnly value={`${cur.toLocaleString('th-TH')} ${unit}`} /></label>
        <label className="f">จำนวนปรับ ({unit})<input type="number" min="0" step="0.0001" value={f.qty} onChange={e => setF({ ...f, qty: e.target.value })} /></label>
        {f.dir === 'in' && <label className="f">ราคาต้นทุนต่อ{unit} (เว้นว่าง = ต้นทุนเฉลี่ย)<input type="number" min="0" step="0.01" value={f.cost} onChange={e => setF({ ...f, cost: e.target.value })} /></label>}
      </div>
      <p className="sub">จำนวนหลังปรับ: <b style={{ color: after != null && after < 0 ? 'var(--red)' : undefined }}>{after == null ? '-' : after.toLocaleString('th-TH')} {unit}</b> · คงเหลือรวมทุกคลัง {onhand.toLocaleString('th-TH')} {unit}</p>
      <label className="f">หมายเหตุ<textarea value={f.note} onChange={e => setF({ ...f, note: e.target.value })} /></label>
      {err && <div className="notice" role="alert" style={{ borderLeftColor: 'var(--red)' }}>{err}</div>}
      <button className="btn" disabled={pending} onClick={save}>{pending ? '...' : 'ปรับยอดคงคลัง'}</button>{' '}
      <button className="btn ghost" onClick={() => setOpen(false)}>ยกเลิก</button>
    </div>
  );
}
