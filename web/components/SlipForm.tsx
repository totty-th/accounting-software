'use client';
import { useState, useTransition } from 'react';
import { createPaymentSlip } from '@/lib/actions';

export interface SlipDoc { key: string; type: string; id: string; no: string; vendor: string; due: string; net: number }

// ใบเตรียมจ่ายใหม่: ติ๊กเลือกเอกสารค้างจ่ายได้หลายผู้จำหน่าย
export function SlipForm({ docs, today }: { docs: SlipDoc[]; today: string }) {
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const [v, setV] = useState({ date: today, due: today, preparer: '', requester: '', approver: '', reason: '' });
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const chosen = docs.filter(d => sel[d.key]);
  const total = Math.round(chosen.reduce((a, d) => a + d.net * 100, 0)) / 100;
  const vendors = new Set(chosen.map(d => d.vendor)).size;
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV(o => ({ ...o, [k]: e.target.value }));
  const save = () => start(async () => {
    const r = await createPaymentSlip({ date: v.date, due: v.due, preparer: v.preparer, requester: v.requester, approver: v.approver,
      reason: v.reason, docs: chosen.map(d => ({ type: d.type, id: d.id })) });
    setMsg(r.error ?? 'สร้างใบเตรียมจ่ายแล้ว'); if (!r.error) setSel({});
  });
  return (
    <details className="panel"><summary>+ ใบเตรียมจ่ายใหม่</summary>
      {docs.length === 0 ? <p className="sub">ไม่มีเอกสารค้างจ่ายที่ยังไม่อยู่ในใบเตรียมจ่าย</p> : (
        <table><thead><tr><th /><th>เอกสาร</th><th>ผู้จำหน่าย</th><th>ครบกำหนด</th><th className="num">ยอดจ่ายสุทธิ</th></tr></thead>
          <tbody>{docs.map(d => (
            <tr key={d.key}><td><input type="checkbox" aria-label={`เลือก ${d.no}`} checked={!!sel[d.key]} onChange={e => setSel(o => ({ ...o, [d.key]: e.target.checked }))} /></td>
              <td className="no">{d.no}</td><td>{d.vendor}</td><td>{d.due}</td><td className="num">{d.net.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td></tr>))}</tbody></table>)}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 6, margin: '8px 0' }}>
        <input aria-label="วันที่" type="date" value={v.date} onChange={set('date')} />
        <input aria-label="ชำระภายในวันที่" type="date" value={v.due} onChange={set('due')} />
        <input aria-label="ผู้จัดเตรียม" placeholder="ผู้จัดเตรียม" value={v.preparer} onChange={set('preparer')} />
        <input aria-label="ผู้ขอ" placeholder="ผู้ขอ" value={v.requester} onChange={set('requester')} />
        <input aria-label="ผู้อนุมัติ" placeholder="ผู้อนุมัติ" value={v.approver} onChange={set('approver')} />
        <input aria-label="สาเหตุที่ขอ" placeholder="สาเหตุที่ขอ" value={v.reason} onChange={set('reason')} />
      </div>
      <div className="acts" style={{ justifyContent: 'flex-start', gap: 8 }}>
        <button type="button" className="btn sm" disabled={pending || chosen.length === 0} onClick={save}>{pending ? '...' : 'สร้างใบเตรียมจ่าย'}</button>
        <span className="sub">{chosen.length} เอกสาร · {vendors} ผู้จำหน่าย · รวม {total.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
      </div>
      {msg && <p className="sub" role="status">{msg}</p>}
    </details>
  );
}
