'use client';
import { useState, useTransition } from 'react';
import { collectReceipt } from '@/lib/actions';

const METHODS: [string, string][] = [['cash', 'เงินสด'], ['transfer', 'โอนเงิน'], ['cheque', 'เช็ค'], ['card', 'บัตรเครดิต'], ['other', 'อื่นๆ']];
interface Row { method: string; bank_account_id: string; amount: string }
export interface BankOpt { id: string; label: string }

// เก็บเงินใบเสร็จ: เลือกช่องทางรับชำระได้หลายแถว ผลรวมต้องเท่ายอดรับสุทธิ
export function CollectForm({ id, net, banks }: { id: string; net: number; banks: BankOpt[] }) {
  const [rows, setRows] = useState<Row[]>([{ method: 'cash', bank_account_id: '', amount: net.toFixed(2) }]);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const sum = Math.round(rows.reduce((a, r) => a + (Number(r.amount) || 0) * 100, 0)) / 100;
  const set = (i: number, p: Partial<Row>) => setRows(rs => rs.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const submit = () => start(async () => {
    const res = await collectReceipt(id, rows.map(r => ({ method: r.method, bank_account_id: r.method === 'transfer' ? r.bank_account_id || undefined : undefined, amount: Number(r.amount) })));
    setMsg(res.error ?? null);
  });
  return (
    <section className="panel">
      <h3>เก็บเงิน</h3>
      <p className="sub">ยอดรับสุทธิ {net.toLocaleString('en-US', { minimumFractionDigits: 2 })} บาท (หลังหัก ณ ที่จ่าย)</p>
      {rows.map((r, i) => (
        <div key={i} className="pay-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr auto', gap: 6, marginBottom: 6 }}>
          <select aria-label="ช่องทาง" value={r.method} onChange={e => set(i, { method: e.target.value })}>
            {METHODS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>
          {r.method === 'transfer'
            ? <select aria-label="บัญชีรับเงิน" style={{ gridColumn: 'span 2' }} value={r.bank_account_id} onChange={e => set(i, { bank_account_id: e.target.value })}>
                <option value="">เลือกบัญชีรับเงิน</option>{banks.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}</select>
            : <span style={{ gridColumn: 'span 2' }} />}
          <input aria-label="จำนวนเงิน" inputMode="decimal" value={r.amount} onChange={e => set(i, { amount: e.target.value })} />
          {rows.length > 1 ? <button type="button" className="btn sm ghost" onClick={() => setRows(rs => rs.filter((_, j) => j !== i))}>ลบ</button> : <span />}
        </div>))}
      <div className="acts" style={{ justifyContent: 'flex-start', gap: 8 }}>
        <button type="button" className="btn sm ghost" onClick={() => setRows(rs => [...rs, { method: 'transfer', bank_account_id: '', amount: '' }])}>+ เพิ่มช่องทาง</button>
        <button type="button" className="btn sm" disabled={pending || sum !== net || rows.some(r => r.method === 'transfer' && !r.bank_account_id)} onClick={submit}>{pending ? '...' : 'เก็บเงิน'}</button>
        {sum !== net && <span className="sub">ผลรวม {sum.toFixed(2)} ไม่เท่ายอดรับสุทธิ</span>}
      </div>
      {msg && <div className="toast" role="alert" onClick={() => setMsg(null)}>{msg}</div>}
    </section>
  );
}
