'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createJv, saveJvDraft, type JvInput } from '@/lib/actions';

type L = { account: string; debit: string; credit: string; desc: string };
export type JvInit = { date: string; contact_id: string; ref_no: string; memo: string; note: string; lines: L[] };
const blank = (): L => ({ account: '', debit: '', credit: '', desc: '' });
const num = (s: string) => Number(s) || 0;

/** ฟอร์มสร้างรายการสมุดรายวันทั่วไป (แบบ FA): บันทึกร่าง / อนุมัติ · เติมผลต่างอัตโนมัติในแถวใหม่ */
export function JvForm({ accounts, contacts, init, draftId }: { accounts: { code: string; name: string }[]; contacts: { id: string; name: string }[]; init: JvInit; draftId?: string }) {
  const r = useRouter();
  const [f, setF] = useState({ date: init.date, contact_id: init.contact_id, ref_no: init.ref_no, memo: init.memo, note: init.note });
  const [lines, setLines] = useState<L[]>(init.lines.length >= 2 ? init.lines : [...init.lines, ...Array(2 - init.lines.length).fill(0).map(blank)]);
  const [same, setSame] = useState(true);
  const [auto, setAuto] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const dr = lines.reduce((s, l) => s + num(l.debit), 0), cr = lines.reduce((s, l) => s + num(l.credit), 0), diff = Math.round((dr - cr) * 100) / 100;
  const code = (v: string) => v.split(' ')[0];
  const upd = (i: number, k: keyof L, v: string) => setLines(ls => ls.map((l, j) => (j !== i ? l : { ...l, [k]: v, ...(k === 'debit' && v ? { credit: '' } : {}), ...(k === 'credit' && v ? { debit: '' } : {}) })));
  const add = () => setLines(ls => { const n = blank(); if (auto && diff !== 0) { if (diff > 0) n.credit = String(diff); else n.debit = String(-diff); } return [...ls, n]; });
  const body = (): JvInput => ({ date: f.date, contact_id: f.contact_id || undefined, ref_no: f.ref_no, memo: f.memo, note: f.note,
    lines: lines.filter(l => l.account || l.debit || l.credit).map(l => ({ account: code(l.account), debit: num(l.debit) || undefined, credit: num(l.credit) || undefined, desc: l.desc || (same ? f.memo : '') })) });
  const draft = () => start(async () => { const x = await saveJvDraft(body(), draftId); if (x.error) setErr(x.error); else r.push('/journals?type=JV'); });
  const approve = () => start(async () => { const x = await createJv(body(), draftId); if (x.error) setErr(x.error); else r.push(`/journals/${x.id}`); });
  return (
    <>
      <div className="panel"><div className="grid">
        <label className="f">วันที่เอกสาร *<input type="date" value={f.date} onChange={e => setF({ ...f, date: e.target.value })} /></label>
        <label className="f">ผู้ติดต่อ<select value={f.contact_id} onChange={e => setF({ ...f, contact_id: e.target.value })}><option value="">— ไม่ระบุ —</option>{contacts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label className="f">เลขที่อ้างอิง<input value={f.ref_no} onChange={e => setF({ ...f, ref_no: e.target.value })} /></label></div>
        <label className="f">คำอธิบาย<input value={f.memo} onChange={e => setF({ ...f, memo: e.target.value })} /></label>
        <label><input type="checkbox" checked={same} onChange={e => setSame(e.target.checked)} /> ใช้คำอธิบายเดียวกัน (รายการย่อยที่ไม่ได้กรอกจะใช้คำอธิบายด้านบน)</label></div>
      <div className="panel" style={{ padding: 0, overflowX: 'auto' }}>
        <datalist id="accs">{accounts.map(a => <option key={a.code} value={`${a.code} ${a.name}`} />)}</datalist>
        <table><thead><tr><th>รหัสบัญชี / ชื่อบัญชี</th><th className="num" style={{ width: 130 }}>เดบิต</th><th className="num" style={{ width: 130 }}>เครดิต</th><th>คำอธิบายรายการย่อย</th><th style={{ width: 36 }} /></tr></thead>
          <tbody>{lines.map((l, i) => <tr key={i}>
            <td><input list="accs" aria-label={`บัญชี แถว ${i + 1}`} value={l.account} onChange={e => upd(i, 'account', e.target.value)} style={{ width: '100%' }} /></td>
            <td><input type="number" min="0" step="0.01" aria-label={`เดบิต แถว ${i + 1}`} value={l.debit} onChange={e => upd(i, 'debit', e.target.value)} style={{ width: '100%', textAlign: 'right' }} /></td>
            <td><input type="number" min="0" step="0.01" aria-label={`เครดิต แถว ${i + 1}`} value={l.credit} onChange={e => upd(i, 'credit', e.target.value)} style={{ width: '100%', textAlign: 'right' }} /></td>
            <td><input aria-label={`คำอธิบาย แถว ${i + 1}`} value={l.desc} onChange={e => upd(i, 'desc', e.target.value)} style={{ width: '100%' }} /></td>
            <td>{lines.length > 2 && <button type="button" className="btn sm ghost" aria-label={`ลบแถว ${i + 1}`} onClick={() => setLines(lines.filter((_, j) => j !== i))}>✕</button>}</td></tr>)}
            <tr style={{ fontWeight: 700 }}><td>ยอดรวมสุทธิ {diff !== 0 && <span style={{ color: 'var(--red)', fontWeight: 400 }}> · ผลต่าง {diff.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</span>}</td>
              <td className="num">{dr.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</td><td className="num">{cr.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</td><td /><td /></tr></tbody></table>
        <div style={{ padding: 10, display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="button" className="btn sm ghost" onClick={add}>+ เพิ่มแถวรายการ</button>
          <label><input type="checkbox" checked={auto} onChange={e => setAuto(e.target.checked)} /> เติมผลต่างอัตโนมัติในแถวใหม่</label></div>
      </div>
      <div className="panel"><label className="f">โน้ตภายในบริษัท<textarea rows={2} value={f.note} onChange={e => setF({ ...f, note: e.target.value })} /></label></div>
      {err && <div className="notice" role="alert" style={{ borderLeftColor: 'var(--red)' }}>{err}</div>}
      <button className="btn" disabled={pending} onClick={approve}>{pending ? 'กำลังบันทึก...' : 'อนุมัติ'}</button>{' '}
      <button className="btn ghost" disabled={pending} onClick={draft}>บันทึกร่าง</button>{' '}
      <button className="btn ghost" disabled={pending} onClick={() => r.back()}>ยกเลิก</button>
    </>
  );
}
