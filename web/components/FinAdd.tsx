'use client';
import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createPettyFund, addChequeAccount } from '@/lib/actions';
import { CardForm } from '@/components/CardForm';

// การ์ด "+ เพิ่มบัญชี" ท้ายรายการ (เงินสดย่อย / เช็คจ่าย / บัตรเครดิต)
export function FinAdd({ kind, banks }: { kind: 'petty-cash' | 'cheque' | 'credit-card'; banks: { id: string; label: string }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [v, setV] = useState({ name: '', limit: '', responsible: '', bank: banks[0]?.id ?? '' });
  const [err, setErr] = useState<string | null>(null);
  const box = useRef<HTMLDetailsElement>(null);
  const bank = banks.some(b => b.id === v.bank) ? v.bank : banks[0]?.id ?? '';   // ธนาคารที่ผูกเช็คแล้วจะหายจากรายการ
  if (kind === 'credit-card') return <CardForm />;
  const go = () => start(async () => {
    const r = kind === 'petty-cash' ? await createPettyFund({ name: v.name, limit: Number(v.limit), responsible: v.responsible }) : await addChequeAccount(bank);
    if (r.error) return setErr(r.error);
    setErr(null); setV({ ...v, name: '', limit: '', responsible: '' }); if (box.current) box.current.open = false; router.refresh();
  });
  return (
    <details className="panel" ref={box}><summary>+ {kind === 'petty-cash' ? 'เพิ่มบัญชีเงินสดย่อย' : 'เพิ่มบัญชีเช็คจ่าย'}</summary>
      <div className="grid" style={{ marginTop: 8 }}>
        {kind === 'petty-cash' ? <>
          <label className="f">ชื่อบัญชี<input value={v.name} onChange={e => setV({ ...v, name: e.target.value })} /></label>
          <label className="f">วงเงินสดย่อย<input type="number" value={v.limit} onChange={e => setV({ ...v, limit: e.target.value })} /></label>
          <label className="f">ผู้รับผิดชอบ<input value={v.responsible} onChange={e => setV({ ...v, responsible: e.target.value })} /></label></> :
          <label className="f">บัญชีธนาคาร<select value={bank} onChange={e => setV({ ...v, bank: e.target.value })}>{banks.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}</select></label>}
      </div>
      {kind === 'cheque' && !banks.length && <p className="sub">ทุกบัญชีธนาคารมีบัญชีเช็คจ่ายแล้ว</p>}
      {err && <div className="notice" role="alert" style={{ borderLeftColor: 'var(--red)' }}>{err}</div>}
      <button className="btn sm" disabled={pending || (kind === 'petty-cash' ? !v.name : !bank)} onClick={go}>{pending ? '...' : 'บันทึก'}</button>
    </details>
  );
}
