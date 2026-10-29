'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setPurchaseVatStatus } from '@/lib/actions';

import { VAT_STATUS } from '@/lib/vat-status';
/** เปลี่ยนสถานะใบกำกับภาษีซื้อของเอกสาร · "รับใบกำกับภาษีแล้ว" ต้องกรอกเลขที่/วันที่ใบกำกับ */
export function VatStatusCell({ type, id, status, filed, invNo, docDate, canWrite }: { type: string; id: string; status: string; filed: boolean; invNo: string; docDate: string; canWrite: boolean }) {
  const r = useRouter();
  const [ask, setAsk] = useState(false); const [no, setNo] = useState(invNo); const [d, setD] = useState(docDate);
  const [err, setErr] = useState<string | null>(null); const [p, start] = useTransition();
  const go = (s: string, inv?: { invoice_no: string; invoice_date: string }) => start(async () => {
    const x = await setPurchaseVatStatus(type, id, s, inv); if (x.error) setErr(x.error); else { setErr(null); setAsk(false); r.refresh(); } });
  if (filed) return <span style={{ color: 'var(--green)' }}>ยื่นแบบแล้ว</span>;
  if (!canWrite) return <span>{VAT_STATUS.find(s => s[0] === status)?.[1]}</span>;
  return (
    <div>
      <select value={status} disabled={p} aria-label="สถานะใบกำกับภาษี" onChange={e => (e.target.value === 'received' ? setAsk(true) : go(e.target.value))}>
        {VAT_STATUS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
      {ask && <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
        <input placeholder="เลขที่ใบกำกับภาษี" value={no} onChange={e => setNo(e.target.value)} aria-label="เลขที่ใบกำกับภาษี" />
        <input type="date" value={d} onChange={e => setD(e.target.value)} aria-label="วันที่ใบกำกับภาษี" />
        <button className="btn sm" disabled={p || !no.trim()} onClick={() => go('received', { invoice_no: no, invoice_date: d })}>บันทึก</button>
        <button className="btn sm ghost" onClick={() => setAsk(false)}>ยกเลิก</button></div>}
      {err && <div className="err" role="alert">{err}</div>}
    </div>
  );
}
