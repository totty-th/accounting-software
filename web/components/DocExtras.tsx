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

/** ข้อมูลจัดส่ง (ใบส่งของ): ฝ่ายขายกรอกหลังใบเสนอราคาอนุมัติ — รับเอง หรือ ส่งให้ที่อยู่ที่อาจต่างจากที่อยู่เปิดบิล */
export function DeliveryForm({ id, d, canEdit }: { id: string; d: any; canEdit: boolean }) {
  const [mode, setMode] = useState<string>(d.delivery_mode ?? '');
  const [f, setF] = useState({ name: d.ship_name ?? '', address: d.ship_address ?? '', phone: d.ship_phone ?? '', carrier: d.carrier ?? '', note: d.delivery_note ?? '' });
  const [m, setM] = useState<string | null>(null); const [p, st] = useTransition();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const ship = mode === 'ship';
  return (<div className="dlv">
    <div className="acts" role="radiogroup" aria-label="วิธีรับสินค้า" style={{ justifyContent: 'flex-start', gap: 14 }}>
      {[['pickup', 'ลูกค้ามารับเอง'], ['ship', 'ส่งให้ลูกค้า']].map(([k, t]) =>
        <label key={k}><input type="radio" name="dlv-mode" checked={mode === k} disabled={!canEdit} onChange={() => setMode(k)} /> {t}</label>)}
    </div>
    {mode && <div className="fgrid" style={{ display: 'grid', gap: 6, marginTop: 8 }}>
      <label>{ship ? 'ชื่อผู้รับ *' : 'ชื่อผู้มารับ'}<input value={f.name} disabled={!canEdit} onChange={set('name')} style={{ width: '100%' }} /></label>
      {ship && <label>ที่อยู่ที่ส่ง * (ต่างจากที่อยู่เปิดบิลได้)<textarea rows={3} value={f.address} disabled={!canEdit} onChange={set('address')} style={{ width: '100%' }} /></label>}
      <label>เบอร์โทรผู้{ship ? 'รับ' : 'มารับ'}<input value={f.phone} disabled={!canEdit} onChange={set('phone')} style={{ width: '100%' }} /></label>
      {ship && <label>ขนส่งโดย<input value={f.carrier} disabled={!canEdit} onChange={set('carrier')} placeholder="เช่น รถบริษัท, Kerry, Flash" style={{ width: '100%' }} /></label>}
      <label>หมายเหตุการจัดส่ง<input value={f.note} disabled={!canEdit} onChange={set('note')} style={{ width: '100%' }} /></label>
    </div>}
    {canEdit && <div className="acts" style={{ justifyContent: 'flex-start', marginTop: 8 }}>
      <button className="btn sm" disabled={p} onClick={() => st(async () => setM(msgOf(await A.setDelivery(id, { mode, ...f })) ?? 'บันทึกแล้ว'))}>{p ? '...' : 'บันทึกข้อมูลจัดส่ง'}</button>
      {mode && <button className="btn sm ghost" disabled={p} onClick={() => st(async () => { const r = await A.setDelivery(id, { mode: '' }); if (!r.error) { setMode(''); setF({ name: '', address: '', phone: '', carrier: '', note: '' }); } setM(msgOf(r) ?? 'ล้างข้อมูลแล้ว'); })}>ล้าง</button>}
      {m && <span className="sub">{m}</span>}</div>}
  </div>);
}
