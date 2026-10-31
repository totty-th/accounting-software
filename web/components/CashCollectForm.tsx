'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { collectCash } from '@/lib/actions';

export interface BankOpt { id: string; label: string }

// เก็บเงินขายสด: เลือกช่องทางรับเงิน (เงินสด หรือโอนเข้าบัญชีธนาคาร) ก่อนยืนยัน
export function CashCollectForm({ id, total, banks }: { id: string; total: number; banks: BankOpt[] }) {
  const r = useRouter();
  const [ch, setCh] = useState('cash');
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const go = () => start(async () => { const x = await collectCash(id, ch === 'cash' ? undefined : ch); if (x.error) setMsg(x.error); else { setMsg(null); r.refresh(); } });
  return (
    <section className="panel">
      <h3>เก็บเงิน</h3>
      <p className="sub">ยอดรับ {total.toLocaleString('en-US', { minimumFractionDigits: 2 })} บาท · เลือกช่องทางที่ได้รับเงิน</p>
      <div className="acts" style={{ justifyContent: 'flex-start', gap: 8 }}>
        <select aria-label="ช่องทางรับเงิน" value={ch} onChange={e => setCh(e.target.value)}>
          <option value="cash">เงินสด</option>
          {banks.map(b => <option key={b.id} value={b.id}>โอนเข้า {b.label}</option>)}
        </select>
        <button type="button" className="btn sm" disabled={pending} onClick={go}>{pending ? '...' : 'เก็บเงิน'}</button>
      </div>
      {msg && <div className="toast" role="alert" onClick={() => setMsg(null)}>{msg}</div>}
    </section>
  );
}
