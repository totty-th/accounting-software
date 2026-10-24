'use client';
import { useState, useTransition } from 'react';
import { collectReceipt } from '@/lib/actions';

const METHODS: [string, string][] = [['cash', 'เงินสด'], ['transfer', 'โอนเงิน'], ['cheque', 'เช็ค'], ['card', 'บัตรเครดิต'], ['other', 'อื่นๆ']];
interface Row { method: string; bank: string; ref_no: string; amount: string }

// เก็บเงินใบเสร็จ: เลือกช่องทางรับชำระได้หลายแถว ผลรวมต้องเท่ายอดรับสุทธิ
export function CollectForm({ id, net }: { id: string; net: number }) {
  const [rows, setRows] = useState<Row[]>([{ method: 'cash', bank: '', ref_no: '', amount: net.toFixed(2) }]);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const sum = Math.round(rows.reduce((a, r) => a + (Number(r.amount) || 0) * 100, 0)) / 100;
  const set = (i: number, p: Partial<Row>) => setRows(rs => rs.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const submit = () => start(async () => {
    const res = await collectReceipt(id, rows.map(r => ({ method: r.method, bank: r.bank || undefined, ref_no: r.ref_no || undefined, amount: Number(r.amount) })));
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
          <input aria-label="ธนาคาร" placeholder="ธนาคาร" value={r.bank} onChange={e => set(i, { bank: e.target.value })} />
          <input aria-label="เลขที่อ้างอิง" placeholder="เลขที่เช็ค/อ้างอิง" value={r.ref_no} onChange={e => set(i, { ref_no: e.target.value })} />
          <input aria-label="จำนวนเงิน" inputMode="decimal" value={r.amount} onChange={e => set(i, { amount: e.target.value })} />
          {rows.length > 1 ? <button type="button" className="btn sm ghost" onClick={() => setRows(rs => rs.filter((_, j) => j !== i))}>ลบ</button> : <span />}
        </div>))}
      <div className="acts" style={{ justifyContent: 'flex-start', gap: 8 }}>
        <button type="button" className="btn sm ghost" onClick={() => setRows(rs => [...rs, { method: 'transfer', bank: '', ref_no: '', amount: '' }])}>+ เพิ่มช่องทาง</button>
        <button type="button" className="btn sm" disabled={pending || sum !== net} onClick={submit}>{pending ? '...' : 'เก็บเงิน'}</button>
        {sum !== net && <span className="sub">ผลรวม {sum.toFixed(2)} ไม่เท่ายอดรับสุทธิ</span>}
      </div>
      {msg && <div className="toast" role="alert" onClick={() => setMsg(null)}>{msg}</div>}
    </section>
  );
}
