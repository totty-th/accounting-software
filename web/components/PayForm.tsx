'use client';
import { useState, useTransition } from 'react';
import type { PurchasePay } from '@/lib/actions';

const METHODS: [string, string][] = [['cash', 'เงินสด'], ['transfer', 'โอนเงิน'], ['card', 'บัตรเครดิต']];
interface Row { method: string; bank_account_id: string; credit_card_id: string; amount: string }
export interface Opt { id: string; label: string }

// จ่ายเงินฝั่งซื้อ: หลายช่องทาง (เงินสด/โอน/บัตรเครดิต) ผลรวมต้องเท่ายอดจ่ายสุทธิ · เช็คและช่องทางอื่นยังไม่เปิด (ยังไม่ทดสอบการลงบัญชี)
export function PayForm({ net, banks, cards, onPay, label = 'จ่ายเงิน' }:
  { net: number; banks: Opt[]; cards: Opt[]; onPay: (p: PurchasePay[]) => Promise<{ error?: string }>; label?: string }) {
  const [rows, setRows] = useState<Row[]>([{ method: 'cash', bank_account_id: '', credit_card_id: '', amount: net.toFixed(2) }]);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const sum = Math.round(rows.reduce((a, r) => a + (Number(r.amount) || 0) * 100, 0)) / 100;
  const set = (i: number, p: Partial<Row>) => setRows(rs => rs.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const bad = (r: Row) => (r.method === 'transfer' && !r.bank_account_id) || (r.method === 'card' && !r.credit_card_id);
  const submit = () => start(async () => {
    const res = await onPay(rows.map(r => ({ method: r.method, amount: Number(r.amount),
      bank_account_id: r.method === 'transfer' ? r.bank_account_id : undefined, credit_card_id: r.method === 'card' ? r.credit_card_id : undefined })));
    setMsg(res.error ?? null);
  });
  return (
    <div className="panel" style={{ marginTop: 6 }}>
      <p className="sub">ยอดจ่ายสุทธิ {net.toLocaleString('en-US', { minimumFractionDigits: 2 })} บาท</p>
      {rows.map((r, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 1fr auto', gap: 6, marginBottom: 6 }}>
          <select aria-label="ช่องทาง" value={r.method} onChange={e => set(i, { method: e.target.value })}>
            {METHODS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>
          {r.method === 'transfer'
            ? <select aria-label="บัญชีจ่ายเงิน" value={r.bank_account_id} onChange={e => set(i, { bank_account_id: e.target.value })}>
                <option value="">เลือกบัญชีจ่ายเงิน</option>{banks.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}</select>
            : r.method === 'card'
              ? <select aria-label="บัตรเครดิต" value={r.credit_card_id} onChange={e => set(i, { credit_card_id: e.target.value })}>
                  <option value="">เลือกบัตรเครดิต</option>{cards.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}</select>
              : <span />}
          <input aria-label="จำนวนเงิน" inputMode="decimal" value={r.amount} onChange={e => set(i, { amount: e.target.value })} />
          {rows.length > 1 ? <button type="button" className="btn sm ghost" onClick={() => setRows(rs => rs.filter((_, j) => j !== i))}>ลบ</button> : <span />}
        </div>))}
      <div className="acts" style={{ justifyContent: 'flex-start', gap: 8 }}>
        <button type="button" className="btn sm ghost" onClick={() => setRows(rs => [...rs, { method: 'cash', bank_account_id: '', credit_card_id: '', amount: '' }])}>+ เพิ่มช่องทาง</button>
        <button type="button" className="btn sm" disabled={pending || sum !== net || rows.some(bad)} onClick={submit}>{pending ? '...' : label}</button>
        {sum !== net && <span className="sub">ผลรวม {sum.toFixed(2)} ไม่เท่ายอดจ่ายสุทธิ</span>}
      </div>
      {msg && <div className="toast" role="alert" onClick={() => setMsg(null)}>{msg}</div>}
    </div>
  );
}
