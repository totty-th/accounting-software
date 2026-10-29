'use client';
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { topupPetty, updatePetty, setPettyActive, deletePetty, updateCard, setCardActive, deleteCard, setChequeActive, deleteChequeAccount } from '@/lib/actions';
import { BankTransfer } from '@/components/BankTransfer';

export type FinInit = { name?: string; limit?: number; responsible?: string; bank?: string; last4?: string; holder?: string; statementDay?: number; dueDay?: number; free?: number };
type Props = { kind: 'petty-cash' | 'cheque' | 'credit-card'; id: string; code: string; active: boolean; canEdit: boolean; canMove: boolean; init: FinInit;
  sources: { code: string; label: string }[]; accounts: { code: string; label: string }[]; label: string };

// เมนู "…" ของการ์ดบัญชีในหมวดการเงิน: เติมเงิน (เงินสดย่อย) · รายการเคลื่อนไหว · โอนไปบัญชีอื่น · แก้ไข · ไม่ใช้งาน · ลบ
export function FinCardMenu(p: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [dlg, setDlg] = useState<null | 'topup' | 'edit' | 'xfer'>(null);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [v, setV] = useState({ date: '', amount: p.init.free ? String(p.init.free) : '', from: p.sources[0]?.code ?? '', name: p.init.name ?? '', limit: String(p.init.limit ?? ''), responsible: p.init.responsible ?? '',
    bank: p.init.bank ?? '', last4: p.init.last4 ?? '', holder: p.init.holder ?? '', statementDay: String(p.init.statementDay ?? 0), dueDay: String(p.init.dueDay ?? 1) });
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV(o => ({ ...o, [k]: e.target.value }));
  const done = (r: { error?: string }) => { if (r.error) setErr(r.error); else { setDlg(null); setErr(null); router.refresh(); } };
  const act = (fn: () => Promise<{ error?: string }>) => { setOpen(false); start(async () => { const r = await fn(); if (r.error) { setErr(r.error); setDlg('edit'); setOpen(false); } else router.refresh(); }); };
  const save = () => start(async () => {
    if (dlg === 'topup') return done(await topupPetty({ id: p.id, date: v.date, amount: Number(v.amount), from: v.from }));
    if (p.kind === 'petty-cash') return done(await updatePetty({ id: p.id, name: v.name, limit: Number(v.limit), responsible: v.responsible }));
    return done(await updateCard({ id: p.id, bank: v.bank, last4: v.last4, holder: v.holder, name: v.name, limit: Number(v.limit), statementDay: Number(v.statementDay), dueDay: Number(v.dueDay) }));
  });
  const hasEdit = p.kind !== 'cheque';
  return (
    <span className="noprint" style={{ position: 'relative' }}>
      <button type="button" className="btn sm ghost" aria-label="เมนู" aria-expanded={open} onClick={() => setOpen(o => !o)} disabled={pending}>•••</button>
      {open && <div className="kebab-pop" style={{ position: 'absolute', right: 0, top: '100%', zIndex: 30, minWidth: 220 }}>
        {p.kind === 'petty-cash' && p.canMove && p.active && <button type="button" className="mi" onClick={() => { setOpen(false); setDlg('topup'); }}>เติมเงิน</button>}
        <Link href={`/finance/${p.kind}/${p.id}`} className="mi">รายการเคลื่อนไหว</Link>
        {p.kind !== 'cheque' && p.canMove && <button type="button" className="mi" onClick={() => { setOpen(false); setDlg('xfer'); }}>โอนเงินไปบัญชีอื่น</button>}
        {p.canEdit && <hr className="navsep" style={{ borderColor: 'var(--line)' }} />}
        {p.canEdit && hasEdit && <button type="button" className="mi" onClick={() => { setOpen(false); setDlg('edit'); }}>แก้ไข</button>}
        {p.canEdit && <button type="button" className="mi" onClick={() => act(() => p.kind === 'petty-cash' ? setPettyActive(p.id, !p.active) : p.kind === 'credit-card' ? setCardActive(p.id, !p.active) : setChequeActive(p.id, !p.active))}>{p.active ? 'ไม่ใช้งาน' : 'กลับมาใช้งาน'}</button>}
        {p.canEdit && <button type="button" className="mi" style={{ color: 'var(--red)' }} onClick={() => { if (window.confirm(`ลบบัญชี "${p.label}" ?`)) act(() => p.kind === 'petty-cash' ? deletePetty(p.id) : p.kind === 'credit-card' ? deleteCard(p.id) : deleteChequeAccount(p.id)); }}>ลบบัญชี</button>}
      </div>}
      {err && !dlg && <div className="notice" role="alert" style={{ borderLeftColor: 'var(--red)', position: 'absolute', right: 0, top: '100%', zIndex: 31, width: 260 }}>{err} <button className="btn sm ghost" onClick={() => setErr(null)}>ปิด</button></div>}
      {dlg === 'xfer' && <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', zIndex: 60, display: 'grid', placeItems: 'center' }}>
        <div style={{ width: 'min(560px, 94vw)' }}><BankTransfer accounts={p.accounts} from={p.code} startOpen onClose={() => setDlg(null)} /></div></div>}
      {(dlg === 'topup' || dlg === 'edit') && <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', zIndex: 60, display: 'grid', placeItems: 'center' }}>
        <div className="panel" style={{ width: 'min(460px, 94vw)', textAlign: 'left' }}>
          <h3 style={{ marginTop: 0 }}>{dlg === 'topup' ? 'เติมเงิน/เบิกคืนเงินสดย่อย' : 'แก้ไขบัญชี'}</h3>
          {dlg === 'topup' ? <div className="grid">
            <div className="f">ชื่อบัญชี<b>{p.label}</b></div>
            <div className="f">วงเงินสดย่อย<b>{(p.init.limit ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</b></div>
            <label className="f">วันที่เติมเงิน (ว่าง = วันนี้)<input type="date" value={v.date} onChange={set('date')} /></label>
            <label className="f">จำนวนเงินที่เติม{p.init.free ? <small className="sub"> (เติม {p.init.free.toLocaleString('en-US', { minimumFractionDigits: 2 })} เพื่อให้เต็มวงเงิน)</small> : null}<input type="number" min="0" value={v.amount} onChange={set('amount')} /></label>
            <label className="f">เติมเงินจากบัญชี<select value={v.from} onChange={set('from')}>{p.sources.map(a => <option key={a.code} value={a.code}>{a.label}</option>)}</select></label>
          </div> : <div className="grid">
            <label className="f">ชื่อ{p.kind === 'credit-card' ? 'บัตร' : 'บัญชี'}<input value={v.name} onChange={set('name')} /></label>
            <label className="f">วงเงิน<input type="number" value={v.limit} onChange={set('limit')} /></label>
            {p.kind === 'petty-cash' && <label className="f">ผู้รับผิดชอบ<input value={v.responsible} onChange={set('responsible')} /></label>}
            {p.kind === 'credit-card' && <>
              <label className="f">ธนาคาร<input value={v.bank} onChange={set('bank')} /></label>
              <label className="f">เลขบัตร 4 ตัวท้าย<input maxLength={4} value={v.last4} onChange={set('last4')} /></label>
              <label className="f">ชื่อผู้ถือบัตร<input value={v.holder} onChange={set('holder')} /></label>
              <label className="f">วันสรุปยอดบัญชี (0 = สิ้นเดือน)<input type="number" min="0" max="31" value={v.statementDay} onChange={set('statementDay')} /></label>
              <label className="f">วันครบกำหนดชำระ<input type="number" min="1" max="31" value={v.dueDay} onChange={set('dueDay')} /></label></>}
          </div>}
          {err && <div className="notice" role="alert" style={{ borderLeftColor: 'var(--red)' }}>{err}</div>}
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button className="btn" disabled={pending} onClick={save}>{pending ? 'กำลังบันทึก...' : 'บันทึกและปิด'}</button>
            <button className="btn ghost" onClick={() => { setDlg(null); setErr(null); }}>ยกเลิก</button></div>
        </div></div>}
    </span>
  );
}
