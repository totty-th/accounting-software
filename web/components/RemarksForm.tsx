'use client';
import { useState, useTransition } from 'react';
import { saveDocRemarks } from '@/lib/actions';

/** ตัวเลือกเอกสาร (ตามรายการของ FA): ทั้งหมด / เอกสารขาย / เอกสารซื้อ */
export const REMARK_GROUPS: { label: string; items: [string, string][] }[] = [
  { label: 'เอกสารทั้งหมด', items: [['ALL', 'เอกสารซื้อและขายทั้งหมดในระบบ']] },
  { label: 'เอกสารขาย', items: [['QT', 'ใบเสนอราคา'], ['BL', 'ใบวางบิล'], ['INV', 'ใบส่งสินค้า/ใบแจ้งหนี้/ใบกำกับภาษี'], ['RE', 'ใบเสร็จรับเงิน'], ['CA', 'ใบกำกับภาษี/ใบเสร็จรับเงิน (เงินสด)'], ['CN', 'ใบลดหนี้/ใบกำกับภาษี'], ['DN', 'ใบเพิ่มหนี้/ใบกำกับภาษี']] },
  { label: 'เอกสารซื้อ', items: [['PO', 'ใบสั่งซื้อ'], ['RI', 'ใบรับสินค้า'], ['PAY', 'ใบเตรียมจ่าย/ใบสำคัญจ่าย'], ['EXP', 'ค่าใช้จ่าย']] },
];
const NOT_YET = new Set(['RE', 'PAY']);   // ยังไม่มีฟอร์มที่เติมหมายเหตุตั้งต้นให้ (เก็บค่าไว้ก่อน)
type Row = { doc: string; text: string };

/** แถว 'เอกสาร + หมายเหตุ' แบบ FA: เลือกทั้งหมด (แถวเดียว) หรือแยกตามชนิดเอกสาร อย่างใดอย่างหนึ่ง · ชนิดที่ใช้แล้วเลือกซ้ำไม่ได้ */
export function RemarksForm({ init, canWrite }: { init: Record<string, string>; canWrite: boolean }) {
  const start: Row[] = Object.entries(init).map(([doc, text]) => ({ doc, text }));
  const [rows, setRows] = useState<Row[]>(start.length ? start : [{ doc: 'ALL', text: '' }]);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, run] = useTransition();
  const upd = (i: number, p: Partial<Row>) => setRows(o => o.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const hasAll = rows.some(r => r.doc === 'ALL');
  const used = (i: number, k: string) => rows.some((r, j) => j !== i && r.doc === k);
  const off = (i: number, k: string) => used(i, k) || (k === 'ALL' ? rows.some((r, j) => j !== i && r.doc) : hasAll && rows[i]?.doc !== 'ALL');
  const save = () => run(async () => { const x = await saveDocRemarks(rows); setMsg(x.error ?? 'บันทึกหมายเหตุเอกสารแล้ว'); });
  return (
    <div className="panel" style={{ display: 'grid', gap: 14, maxWidth: 760 }}>
      <b>ระบุหมายเหตุแยกตามเอกสาร</b>
      <span className="sub">หมายเหตุจะระบุที่ท้ายเอกสารตามเอกสารที่กำหนด · เลือก "เอกสารทั้งหมด" หรือแยกตามชนิดเอกสาร อย่างใดอย่างหนึ่ง</span>
      {rows.map((r, i) => (
        <div key={i} style={{ display: 'grid', gap: 6, gridTemplateColumns: '90px 1fr auto', alignItems: 'start' }}>
          <label style={{ gridColumn: '1 / 4', display: 'contents' }}>
            <span>เอกสาร:</span>
            <select value={r.doc} disabled={!canWrite} onChange={e => upd(i, { doc: e.target.value })}>
              <option value="">--กรุณาเลือกเอกสารที่ต้องการระบุหมายเหตุแยก--</option>
              {REMARK_GROUPS.map(g => <optgroup key={g.label} label={g.label}>{g.items.map(([k, n]) => <option key={k} value={k} disabled={off(i, k)}>{n}</option>)}</optgroup>)}
            </select>
            {canWrite ? <button type="button" className="btn ghost sm" onClick={() => setRows(o => o.filter((_, j) => j !== i))}>🗑 ลบหมายเหตุ</button> : <span />}
          </label>
          <span>หมายเหตุ:</span>
          <textarea rows={3} maxLength={1000} value={r.text} disabled={!canWrite} onChange={e => upd(i, { text: e.target.value })} style={{ gridColumn: '2 / 4' }} />
          {NOT_YET.has(r.doc) && <span className="sub" style={{ gridColumn: '2 / 4' }}>ชนิดนี้เก็บค่าไว้ก่อน — ยังไม่มีฟอร์มสร้างเอกสารที่เติมหมายเหตุตั้งต้นให้</span>}
        </div>))}
      {canWrite && !hasAll && !rows.some(r => !r.doc) && rows.length < 11 && <div><button type="button" className="btn ghost sm" onClick={() => setRows(o => [...o, { doc: '', text: '' }])}>+ เพิ่มหมายเหตุ</button></div>}
      {canWrite && <div className="acts" style={{ justifyContent: 'flex-start', gap: 8 }}><button type="button" className="btn" disabled={pending} onClick={save}>บันทึกข้อมูล</button>{msg && <span className="sub" role="status">{msg}</span>}</div>}
    </div>
  );
}
