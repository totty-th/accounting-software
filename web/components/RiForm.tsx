'use client';
import { useState, useTransition } from 'react';

interface Opt { id: string; label: string; price?: number }
interface Row { product_id: string; qty: string; unit_price: string }

// ใบรับสินค้าใหม่: ผู้ขาย + รายการสินค้านับสต็อก (ราคาไม่รวม VAT 7%)
export function RiForm({ vendors, products, today, action, title = 'ใบรับสินค้าใหม่' }:
  { vendors: Opt[]; products: Opt[]; today: string; action: (p: { date: string; contact: string; lines: any[] }) => Promise<{ error?: string }>; title?: string }) {
  const [date, setDate] = useState(today);
  const [vendor, setVendor] = useState('');
  const [rows, setRows] = useState<Row[]>([{ product_id: '', qty: '1', unit_price: '' }]);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (i: number, p: Partial<Row>) => setRows(rs => rs.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const pick = (i: number, id: string) => set(i, { product_id: id, unit_price: String(products.find(p => p.id === id)?.price ?? '') });
  const ok = vendor && rows.every(r => r.product_id && Number(r.qty) > 0 && r.unit_price !== '');
  const save = () => start(async () => {
    const r = await action({ date, contact: vendor,
      lines: rows.map(x => ({ product_id: x.product_id, qty: Number(x.qty), unit_price: Number(x.unit_price) })) });
    setMsg(r.error ?? 'บันทึกแล้ว');
    if (!r.error) setRows([{ product_id: '', qty: '1', unit_price: '' }]);
  });
  return (
    <details className="panel"><summary>+ {title}</summary>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 6, margin: '8px 0' }}>
        <input aria-label="วันที่" type="date" value={date} onChange={e => setDate(e.target.value)} />
        <select aria-label="ผู้จำหน่าย" value={vendor} onChange={e => setVendor(e.target.value)}>
          <option value="">เลือกผู้จำหน่าย</option>{vendors.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}</select>
      </div>
      {rows.map((r, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '3fr 1fr 1fr auto', gap: 6, marginBottom: 6 }}>
          <select aria-label="สินค้า" value={r.product_id} onChange={e => pick(i, e.target.value)}>
            <option value="">เลือกสินค้า</option>{products.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</select>
          <input aria-label="จำนวน" inputMode="decimal" value={r.qty} onChange={e => set(i, { qty: e.target.value })} />
          <input aria-label="ราคาต่อหน่วย" inputMode="decimal" value={r.unit_price} onChange={e => set(i, { unit_price: e.target.value })} />
          {rows.length > 1 ? <button type="button" className="btn sm ghost" onClick={() => setRows(rs => rs.filter((_, j) => j !== i))}>ลบ</button> : <span />}
        </div>))}
      <div className="acts" style={{ justifyContent: 'flex-start', gap: 8 }}>
        <button type="button" className="btn sm ghost" onClick={() => setRows(rs => [...rs, { product_id: '', qty: '1', unit_price: '' }])}>+ เพิ่มรายการ</button>
        <button type="button" className="btn sm" disabled={pending || !ok} onClick={save}>{pending ? '...' : 'บันทึก'}</button>
      </div>
      {msg && <p className="sub" role="status">{msg}</p>}
    </details>
  );
}
