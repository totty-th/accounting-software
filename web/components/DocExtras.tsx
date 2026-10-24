'use client';
import { useRef, useState, useTransition } from 'react';
import * as A from '@/lib/actions';

const msgOf = (r: { error?: string }) => r.error ?? null;

/** โน้ตภายในบริษัท (ไม่แสดงบนเอกสาร/PDF/ลิงก์แชร์) */
export function NoteBox({ id, note, canEdit }: { id: string; note: string; canEdit: boolean }) {
  const [v, setV] = useState(note); const [m, setM] = useState<string | null>(null); const [p, st] = useTransition();
  return (<>
    <textarea rows={4} value={v} disabled={!canEdit} onChange={e => setV(e.target.value)} style={{ width: '100%' }} placeholder="โน้ตภายในบริษัท (ลูกค้าไม่เห็น)" />
    {canEdit && <div className="acts" style={{ justifyContent: 'flex-start', marginTop: 6 }}>
      <button className="btn sm" disabled={p || v === note} onClick={() => st(async () => setM(msgOf(await A.saveSalesNote(id, v)) ?? 'บันทึกแล้ว'))}>{p ? '...' : 'บันทึกโน้ต'}</button>
      {m && <span className="sub">{m}</span>}</div>}
  </>);
}

/** ไฟล์แนบ: เลือกไฟล์แล้วอัปโหลดทันที (ไม่เกิน 5 MB, 5 ไฟล์) */
export function FileUpload({ id }: { id: string }) {
  const ref = useRef<HTMLInputElement>(null); const [m, setM] = useState<string | null>(null); const [p, st] = useTransition();
  return (<div style={{ marginTop: 8 }}>
    <input ref={ref} type="file" disabled={p} onChange={e => {
      const file = e.target.files?.[0]; if (!file) return;
      const f = new FormData(); f.set('id', id); f.set('file', file);
      st(async () => { setM(msgOf(await A.uploadSalesFile(f))); if (ref.current) ref.current.value = ''; });
    }} />
    {p && <span className="sub"> กำลังอัปโหลด...</span>}{m && <div className="toast" role="alert" onClick={() => setM(null)}>{m}</div>}
  </div>);
}
export function FileRemove({ docId, fileId }: { docId: string; fileId: string }) {
  const [m, setM] = useState<string | null>(null); const [p, st] = useTransition();
  return (<><button className="btn sm danger" disabled={p} onClick={() => st(async () => setM(msgOf(await A.removeSalesFile(docId, fileId))))}>ลบ</button>
    {m && <span className="sub"> {m}</span>}</>);
}

/** หัก ณ ที่จ่ายของใบเพิ่มหนี้ (อัตราเดียวทั้งใบ) */
export function WhtPick({ id, rate, canEdit }: { id: string; rate: number; canEdit: boolean }) {
  const [v, setV] = useState(String(rate)); const [m, setM] = useState<string | null>(null); const [p, st] = useTransition();
  return (<div>
    <select value={v} disabled={!canEdit || p} onChange={e => { const x = e.target.value; setV(x); st(async () => { const r = await A.setDnWht(id, Number(x)); if (r.error) { setM(r.error); setV(String(rate)); } else setM(null); }); }}>
      {['0', '1', '1.5', '2', '3', '5'].map(x => <option key={x} value={x}>{x === '0' ? 'ไม่หัก' : `${x}%`}</option>)}
    </select>{m && <div className="toast" role="alert" onClick={() => setM(null)}>{m}</div>}
  </div>);
}
