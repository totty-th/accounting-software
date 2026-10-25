'use client';
import { useState, useTransition } from 'react';
import { splitPoToRi } from '@/lib/actions';

const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// แบ่งจ่ายใบรับสินค้าจาก PO: ระบุ % หรือจำนวนเงิน · รับเข้าสต็อกได้ครั้งเดียว · เกิน 100% ต้องยืนยัน (ตาม FA)
export function SplitRiForm({ poId, total, billed, today }: { poId: string; total: number; billed: number; today: string }) {
  const [mode, setMode] = useState<'percent' | 'amount'>('percent');
  const [val, setVal] = useState('');
  const [date, setDate] = useState(today);
  const [stock, setStock] = useState(false);
  const [armed, setArmed] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const v = Number(val) || 0;
  const amt = mode === 'percent' ? Math.round(total * v) / 100 : v;
  const over = billed + amt > total + 0.005;
  const submit = () => {
    if (over && !armed) { setArmed(true); return; }
    start(async () => { const r = await splitPoToRi(poId, date, mode, v, stock); setMsg(r.error ?? null); setArmed(false); });
  };
  return (
    <div className="panel" style={{ marginTop: 6, minWidth: 280 }}>
      <p className="sub">ยอด PO {fmt(total)} · เรียกเก็บแล้ว {fmt(billed)} · คงเหลือ {fmt(Math.max(total - billed, 0))}</p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 6 }}>
        <select aria-label="โหมดแบ่งจ่าย" value={mode} onChange={e => setMode(e.target.value as any)}>
          <option value="percent">เปอร์เซ็นต์</option><option value="amount">จำนวนเงิน</option></select>
        <input aria-label="ค่าแบ่งจ่าย" type="number" step="0.01" min="0" value={val} onChange={e => { setVal(e.target.value); setArmed(false); }} />
        <input aria-label="วันที่ใบรับสินค้า" type="date" value={date} onChange={e => setDate(e.target.value)} />
        <label><input type="checkbox" checked={stock} onChange={e => setStock(e.target.checked)} /> รับเข้าสต็อกในครั้งนี้</label>
      </div>
      <p className="sub">ใบนี้ {fmt(amt)} บาท</p>
      {armed && <p role="alert" style={{ color: 'var(--danger, #c00)' }}>จะส่งผลให้สถานะการเรียกเก็บเงินเกิน 100% — กดอีกครั้งเพื่อยืนยัน</p>}
      <button className="btn sm" disabled={pending || v <= 0} onClick={submit}>{pending ? '...' : armed ? 'ยืนยัน' : 'สร้างใบรับสินค้า'}</button>
      {msg && <div className="toast" role="alert" onClick={() => setMsg(null)}>{msg}</div>}
    </div>
  );
}
