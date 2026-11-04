'use client';
import { useState, useTransition } from 'react';
import { splitPoToRi, splitPoToRiQty } from '@/lib/actions';

const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// แบ่งจ่ายใบรับสินค้าจาก PO: ระบุ % หรือจำนวนเงิน · รับเข้าสต็อกได้ครั้งเดียว · เกิน 100% ต้องยืนยัน (ตาม FA)
type Ln = { line_no: number; name: string; unit: string; qty: number; done: number };
export function SplitRiForm({ poId, total, billed, today, lines = [], status = 'approved' }: { poId: string; total: number; billed: number; today: string; lines?: Ln[]; status?: string }) {
  const [mode, setMode] = useState<'percent' | 'amount' | 'qty'>('percent');
  const [qs, setQs] = useState<Record<number, string>>({});
  const [val, setVal] = useState('');
  const [date, setDate] = useState(today);
  const [stock, setStock] = useState(false);
  const [armed, setArmed] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const v = Number(val) || 0;
  const qtyRows = lines.map(l => ({ line_no: l.line_no, qty: Number(qs[l.line_no]) || 0 })).filter(r => r.qty > 0);
  const amt = mode === 'percent' ? Math.round(total * v) / 100 : v;
  const over = billed + amt > total + 0.005;
  const submit = () => {
    if (mode === 'qty') { start(async () => { const r = await splitPoToRiQty(poId, date, qtyRows); setMsg(r.error ?? null); if (!r.error) setQs({}); }); return; }
    if (over && !armed) { setArmed(true); return; }
    start(async () => { const r = await splitPoToRi(poId, date, mode, v, stock); setMsg(r.error ?? null); setArmed(false); });
  };
  return (
    <div className="panel" style={{ marginTop: 6, minWidth: 280 }}>
      <p className="sub">ยอด PO {fmt(total)} · เรียกเก็บแล้ว {fmt(billed)} · คงเหลือ {fmt(Math.max(total - billed, 0))}</p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 6 }}>
        <select aria-label="โหมดแบ่งจ่าย" value={mode} onChange={e => setMode(e.target.value as any)}>
          <option value="percent">เปอร์เซ็นต์</option><option value="amount">จำนวนเงิน</option>
          <option value="qty" disabled={status === 'pending'}>ตามจำนวนสินค้า</option></select>
        {mode !== 'qty' && <input aria-label="ค่าแบ่งจ่าย" type="number" step="0.01" min="0" value={val} onChange={e => { setVal(e.target.value); setArmed(false); }} />}
        <input aria-label="วันที่ใบรับสินค้า" type="date" value={date} onChange={e => setDate(e.target.value)} />
        {mode !== 'qty' && <label><input type="checkbox" checked={stock} onChange={e => setStock(e.target.checked)} /> รับเข้าสต็อกในครั้งนี้</label>}
      </div>
      {mode === 'qty' ? (
        <div style={{ marginBottom: 6 }}>
          <p className="sub">ระบุจำนวนที่รับในงวดนี้ — สต็อกเข้าตามจำนวนที่แบ่งทันทีที่บันทึก</p>
          {lines.map(l => (
            <label key={l.line_no} style={{ display: 'grid', gridTemplateColumns: '1fr 90px', gap: 6, alignItems: 'center' }}>
              <span>{l.name} <span className="sub">(แบ่งแล้ว {l.done} / {l.qty} {l.unit})</span></span>
              <input aria-label={`จำนวนแบ่ง ${l.name}`} type="number" min="0" max={l.qty - l.done} step="any" value={qs[l.line_no] ?? ''}
                placeholder={String(Math.max(l.qty - l.done, 0))} onChange={e => setQs({ ...qs, [l.line_no]: e.target.value })} disabled={l.qty - l.done <= 0} />
            </label>))}
        </div>
      ) : <p className="sub">ใบนี้ {fmt(amt)} บาท</p>}
      {armed && <p role="alert" style={{ color: 'var(--danger, #c00)' }}>จะส่งผลให้สถานะการเรียกเก็บเงินเกิน 100% — กดอีกครั้งเพื่อยืนยัน</p>}
      <button className="btn sm" disabled={pending || (mode === 'qty' ? qtyRows.length === 0 : v <= 0)} onClick={submit}>{pending ? '...' : armed ? 'ยืนยัน' : 'สร้างใบรับสินค้า'}</button>
      {msg && <div className="toast" role="alert" onClick={() => setMsg(null)}>{msg}</div>}
    </div>
  );
}
