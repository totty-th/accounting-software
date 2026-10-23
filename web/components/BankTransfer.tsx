'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { bankTransfer } from '@/lib/actions';

// โอนเงินระหว่างบัญชี (เงินสด ↔ ธนาคาร ↔ ธนาคาร) ค่าธรรมเนียมจ่ายจากบัญชีต้นทาง
export function BankTransfer({ accounts }: { accounts: { code: string; label: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [v, setV] = useState({ from: accounts[0]?.code ?? '', to: accounts[1]?.code ?? '', date: '', amount: '', fee: '' });
  const [err, setErr] = useState<string | null>(null);
  if (!open) return <button className="btn ghost" onClick={() => setOpen(true)}>โอนเงินระหว่างบัญชี</button>;
  const go = () => start(async () => {
    const r = await bankTransfer({ from: v.from, to: v.to, date: v.date, amount: Number(v.amount), fee: Number(v.fee || 0) });
    if (r.error) return setErr(r.error);
    setOpen(false); setErr(null); setV({ ...v, amount: '', fee: '' }); router.refresh();
  });
  const sel = (k: 'from' | 'to') => (
    <select value={v[k]} onChange={e => setV({ ...v, [k]: e.target.value })}>
      {accounts.map(a => <option key={a.code} value={a.code}>{a.label}</option>)}</select>);
  return (
    <div className="panel" style={{ marginBottom: 16, flexBasis: '100%' }}>
      <div className="grid">
        <label className="f">บัญชีต้นทาง{sel('from')}</label>
        <label className="f">บัญชีปลายทาง{sel('to')}</label>
        <label className="f">วันที่ (ว่าง = วันนี้)<input placeholder="YYYY-MM-DD" value={v.date} onChange={e => setV({ ...v, date: e.target.value })} /></label>
        <label className="f">จำนวนเงิน<input type="number" value={v.amount} onChange={e => setV({ ...v, amount: e.target.value })} /></label>
        <label className="f">ค่าธรรมเนียม (จ่ายจากต้นทาง)<input type="number" value={v.fee} onChange={e => setV({ ...v, fee: e.target.value })} /></label>
      </div>
      {err && <div className="notice" role="alert" style={{ borderLeftColor: 'var(--red)' }}>{err}</div>}
      <button className="btn" disabled={pending || !v.amount} onClick={go}>{pending ? 'กำลังบันทึก...' : 'โอนเงิน'}</button>{' '}
      <button className="btn ghost" onClick={() => setOpen(false)}>ปิด</button>
    </div>
  );
}
