'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setPurchaseVatStatus, setPp36Receipt } from '@/lib/actions';
import { VAT_STATUS } from '@/lib/vat-status';

/** สถานะใบกำกับภาษีซื้อ (แบบ FA): รอใบกำกับ / รับใบกำกับ (เลือกแบบ ภ.พ.30 หรือ ภ.พ.36) / ไม่ใช้สิทธิขอคืน
 *  รอยื่น ภ.พ.36 = รับใบกำกับแบบ ภ.พ.36 ที่ยังไม่ยื่น · ยื่นแบบแล้ว = อยู่ในแบบที่ยื่น (เลือกเองไม่ได้) */
export function VatStatusCell({ type, id, status, form, filed, stage = '', rd = '', invNo, docDate, docTotal, canWrite }:
  { type: string; id: string; status: string; form: string; filed: boolean; stage?: string; rd?: string; invNo: string; docDate: string; docTotal: number; canWrite: boolean }) {
  const r = useRouter();
  const [ask, setAsk] = useState(false); const [no, setNo] = useState(invNo); const [d, setD] = useState(docDate); const [f, setF] = useState(form || 'PP30');
  const [base, setBase] = useState(String(docTotal));
  const [err, setErr] = useState<string | null>(null); const [p, start] = useTransition();
  const go = (s: string, inv?: { invoice_no: string; invoice_date: string; vat_form: string; base_amount?: number }) => start(async () => {
    const x = await setPurchaseVatStatus(type, id, s, inv); if (x.error) setErr(x.error); else { setErr(null); setAsk(false); r.refresh(); } });
  const [rdOpen, setRdOpen] = useState(false); const [rno, setRno] = useState(''); const [rdate, setRdate] = useState('');
  if (filed) return <span style={{ color: 'var(--green)' }}>ยื่นแบบแล้ว</span>;
  if (stage === 'f36') return <span>ยื่น ภ.พ.36 แล้ว (รอชำระ)</span>;
  if (stage === 'rdwait' || stage === 'rddone') return (
    <div>
      <span style={{ color: stage === 'rdwait' ? 'var(--purple)' : 'var(--green)' }}>{stage === 'rdwait' ? 'รอใบเสร็จสรรพากร' : `รับใบเสร็จสรรพากรแล้ว (${rd})`}</span>
      {canWrite && !rdOpen && <> <button className="btn sm ghost" onClick={() => { setRno(rd); setRdOpen(true); }}>{stage === 'rdwait' ? 'บันทึกใบเสร็จ' : 'แก้ไข'}</button></>}
      {rdOpen && <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <input placeholder="เลขที่ใบเสร็จสรรพากร" value={rno} onChange={e => setRno(e.target.value)} aria-label="เลขที่ใบเสร็จสรรพากร" />
        <input type="date" value={rdate} onChange={e => setRdate(e.target.value)} aria-label="วันที่ใบเสร็จ" />
        <button className="btn sm" disabled={p} onClick={() => start(async () => { const x = await setPp36Receipt(type, id, rno, rdate); if (x.error) setErr(x.error); else { setErr(null); setRdOpen(false); r.refresh(); } })}>บันทึก</button>
        {stage === 'rddone' && <button className="btn sm ghost" disabled={p} onClick={() => start(async () => { const x = await setPp36Receipt(type, id, '', ''); if (x.error) setErr(x.error); else { setErr(null); setRdOpen(false); r.refresh(); } })}>ล้างใบเสร็จ</button>}
        <button className="btn sm ghost" onClick={() => setRdOpen(false)}>ยกเลิก</button></div>}
      {err && <div className="err" role="alert">{err}</div>}
    </div>);
  const pending36 = status === 'received' && form === 'PP36';
  if (!canWrite) return <span>{pending36 ? 'รอยื่น ภ.พ.36' : VAT_STATUS.find(s => s[0] === status)?.[1]}</span>;
  return (
    <div>
      <select value={status} disabled={p} aria-label="สถานะใบกำกับภาษี" onChange={e => (e.target.value === 'received' ? setAsk(true) : go(e.target.value))}
        style={pending36 ? { color: 'var(--purple)' } : undefined}>
        {VAT_STATUS.map(([k, l]) => <option key={k} value={k}>{k === 'received' && pending36 ? 'รอยื่น ภ.พ.36' : l}</option>)}</select>
      {ask && <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <input placeholder="เลขที่ใบกำกับภาษี" value={no} onChange={e => setNo(e.target.value)} aria-label="เลขที่ใบกำกับภาษี" />
        <input type="date" value={d} onChange={e => setD(e.target.value)} aria-label="วันที่ใบกำกับภาษี" />
        <label><input type="radio" checked={f === 'PP30'} onChange={() => setF('PP30')} /> ภ.พ.30</label>
        <label><input type="radio" checked={f === 'PP36'} onChange={() => setF('PP36')} /> ภ.พ.36</label>
        {f === 'PP36' && <input type="number" step="0.01" value={base} onChange={e => setBase(e.target.value)} aria-label="มูลค่าที่จ่ายจริง" title="มูลค่าที่จ่ายจริง (VAT 7% ของฐาน)" style={{ width: 120 }} />}
        <button className="btn sm" disabled={p || !no.trim()} onClick={() => go('received', { invoice_no: no, invoice_date: d, vat_form: f, base_amount: f === 'PP36' ? Number(base) : undefined })}>บันทึก</button>
        <button className="btn sm ghost" onClick={() => setAsk(false)}>ยกเลิก</button></div>}
      {err && <div className="err" role="alert">{err}</div>}
    </div>
  );
}
