'use client';
import { useState, useTransition } from 'react';
import { createStandaloneWht } from '@/lib/actions';

const FORMS: [string, string][] = [['PND53', 'ภ.ง.ด.53'], ['PND3', 'ภ.ง.ด.3'], ['PND1K', 'ภ.ง.ด.1ก'], ['PND1KS', 'ภ.ง.ด.1ก (พิเศษ)'], ['PND2', 'ภ.ง.ด.2'], ['PND2K', 'ภ.ง.ด.2ก'], ['PND3K', 'ภ.ง.ด.3ก']];
const RATES = ['0.5', '0.75', '1', '1.5', '2', '3', '5', '10', '15'];
type L = { income_type: string; rate: string; amount: string; vat_mode: string; wht: string };
const blank = (): L => ({ income_type: '', rate: '3', amount: '', vat_mode: 'none', wht: '' });

/** สร้างหนังสือรับรองหัก ณ ที่จ่ายแบบเอกสารอิสระ (ไม่ผูกค่าใช้จ่าย ไม่ลงบัญชี) */
export function WhtForm({ today, vendors }: { today: string; vendors: { id: string; label: string }[] }) {
  const [date, setDate] = useState(today), [contact, setContact] = useState(''), [form, setForm] = useState('PND53');
  const [lines, setLines] = useState<L[]>([blank()]);
  const [err, setErr] = useState<string | null>(null); const [pending, start] = useTransition();
  const set = (i: number, k: keyof L, v: string) => setLines(ls => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const calc = (l: L) => { const a = Number(l.amount) || 0; const b = l.vat_mode === 'inclusive' ? Math.round(a * 10000 / 107) / 100 : a;
    return l.rate === 'fixed' ? Number(l.wht) || 0 : Math.round(b * Number(l.rate)) / 100; };
  const total = lines.reduce((a, l) => a + calc(l), 0);
  const submit = () => start(async () => {
    setErr(null);
    const r = await createStandaloneWht({ date, contact, form, category: '5', lines: lines.map(l => ({ income_type: l.income_type, amount: Number(l.amount),
      vat_mode: l.vat_mode, ...(l.rate === 'fixed' ? { rate: null, wht: Number(l.wht) } : { rate: Number(l.rate) }) })) });
    if (r.error) setErr(r.error); else { setLines([blank()]); setContact(''); }
  });
  return (
    <details className="panel" style={{ margin: '8px 0', padding: 12 }}>
      <summary className="btn">+ สร้างหนังสือรับรองหัก ณ ที่จ่ายใหม่</summary>
      <div style={{ display: 'grid', gap: 8, marginTop: 10, maxWidth: 760 }}>
        <label>วันที่จ่าย <input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
        <label>ผู้ถูกหักภาษี <select value={contact} onChange={e => setContact(e.target.value)}><option value="">เลือก...</option>
          {vendors.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}</select></label>
        <label>แบบยื่น <select value={form} onChange={e => setForm(e.target.value)}>{FORMS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        {lines.map((l, i) => (
          <div key={i} style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'end' }}>
            <label style={{ flex: '2 1 160px' }}>ประเภทเงินได้ <input value={l.income_type} onChange={e => set(i, 'income_type', e.target.value)} placeholder="เช่น ค่าบริการ" /></label>
            <label>อัตรา <select value={l.rate} onChange={e => set(i, 'rate', e.target.value)}>{RATES.map(r => <option key={r} value={r}>{r}%</option>)}<option value="fixed">ระบุจำนวนเอง</option></select></label>
            <label>จำนวนเงิน <input type="number" step="0.01" min="0" value={l.amount} onChange={e => set(i, 'amount', e.target.value)} /></label>
            <label>VAT <select value={l.vat_mode} onChange={e => set(i, 'vat_mode', e.target.value)}><option value="none">ไม่มี VAT</option><option value="exclusive">แยก VAT</option><option value="inclusive">รวม VAT</option></select></label>
            {l.rate === 'fixed' && <label>ภาษีที่หัก <input type="number" step="0.01" min="0" value={l.wht} onChange={e => set(i, 'wht', e.target.value)} /></label>}
            <span className="num">{calc(l).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
            {lines.length > 1 && <button type="button" className="btn sm ghost" onClick={() => setLines(ls => ls.filter((_, j) => j !== i))}>ลบ</button>}
          </div>))}
        <div><button type="button" className="btn sm ghost" onClick={() => setLines(ls => [...ls, blank()])}>+ เพิ่มรายการ</button></div>
        <b>ภาษีที่หักรวม {total.toLocaleString('en-US', { minimumFractionDigits: 2 })} บาท</b>
        {err && <div className="toast" role="alert" onClick={() => setErr(null)}>{err}</div>}
        <div><button type="button" className="btn" disabled={pending || !contact} onClick={submit}>{pending ? '...' : 'บันทึก'}</button></div>
      </div>
    </details>
  );
}
