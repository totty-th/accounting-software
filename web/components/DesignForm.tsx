'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { saveDocDesign, resetDocDesign } from '@/lib/actions';
import { DEFAULT_DESIGN, DESIGN_TYPES, FONT_TH, TITLE_PRESETS, type DocDesign } from '@/lib/doc-design';

type Rows = Record<string, Partial<DocDesign>>;
/** ตั้งค่ารูปแบบดีไซน์เอกสาร: เรียบง่าย = ใช้กับทุกเอกสาร · ขั้นสูง = ตั้งแยกชนิดเอกสาร (ทับค่าเรียบง่าย) */
export function DesignForm({ init, canWrite }: { init: Rows; canWrite: boolean }) {
  const r = useRouter(); const [pending, start] = useTransition();
  const [adv, setAdv] = useState(Object.keys(init).some(k => k !== 'all'));
  const [type, setType] = useState('INV');
  const [rows, setRows] = useState<Rows>(init);
  const [msg, setMsg] = useState<string | null>(null);
  const scope = adv ? type : 'all';
  const base = { ...DEFAULT_DESIGN, ...(adv ? init.all ?? {} : {}), ...(rows[scope] ?? {}) } as DocDesign;
  const set = <K extends keyof DocDesign>(k: K, v: DocDesign[K]) => setRows(o => ({ ...o, [scope]: { ...(o[scope] ?? {}), [k]: v } }));
  const sw = (k: 'bw' | 'copy_mark' | 'header_bg' | 'logo' | 'stamp' | 'show_credit' | 'show_due', label: string) =>
    <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={base[k]} disabled={!canWrite} onChange={e => set(k, e.target.checked)} /> {label}</label>;
  const save = () => start(async () => { const x = await saveDocDesign(scope, { ...DEFAULT_DESIGN, ...(rows[scope] ?? {}) }); setMsg(x.error ?? 'บันทึกรูปแบบเอกสารแล้ว (มีผลกับเอกสารทั้งหมดที่พิมพ์/แชร์ รวมที่สร้างไว้ก่อนหน้า)'); if (!x.error) r.refresh(); });
  const reset = () => start(async () => { if (!window.confirm('รีเซ็ตรูปแบบดีไซน์เอกสารทั้งหมดกลับค่าเริ่มต้น?')) return; const x = await resetDocDesign(); if (x.error) setMsg(x.error); else { setRows({}); setAdv(false); setMsg('รีเซ็ตแล้ว'); r.refresh(); } });
  return (
    <div className="panel" style={{ display: 'grid', gap: 10, maxWidth: 640 }}>
      <div className="acts" style={{ justifyContent: 'flex-start', gap: 8 }}><b>โหมดการใช้งาน</b>
        <button type="button" className={`chip${!adv ? ' on' : ''}`} onClick={() => setAdv(false)}>เรียบง่าย</button>
        <button type="button" className={`chip${adv ? ' on' : ''}`} onClick={() => setAdv(true)}>ขั้นสูง</button></div>
      <p className="sub">{adv ? 'ตั้งแยกตามชนิดเอกสาร — ค่าที่ไม่ได้ตั้งเฉพาะชนิดจะใช้ค่าของโหมดเรียบง่าย' : 'ตั้งครั้งเดียวใช้กับทุกเอกสารขาย'}</p>
      {adv && <label>ชนิดเอกสาร<select value={type} onChange={e => setType(e.target.value)}>{DESIGN_TYPES.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></label>}
      <fieldset style={{ display: 'grid', gap: 8 }}><legend>รูปแบบกระดาษ</legend>
        <div className="acts" style={{ justifyContent: 'flex-start', gap: 16 }}><b>ขนาด</b>
          <label><input type="radio" checked={base.paper === 'a4'} disabled={!canWrite} onChange={() => set('paper', 'a4')} /> A4</label>
          <label><input type="radio" checked={base.paper === 'continuous'} disabled={!canWrite} onChange={() => set('paper', 'continuous')} /> กระดาษต่อเนื่อง</label></div>
        {sw('bw', 'เอกสารขาว-ดำ')}
        <label>ตัวอักษร<select value={base.font} disabled={!canWrite} onChange={e => set('font', e.target.value as DocDesign['font'])}>{Object.entries(FONT_TH).map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></label>
        <label>ขนาดตัวอักษร<select value={base.size} disabled={!canWrite} onChange={e => set('size', e.target.value as DocDesign['size'])}><option value="s">เล็ก</option><option value="m">กลาง (ค่าเริ่มต้น)</option><option value="l">ใหญ่</option></select></label>
        {sw('copy_mark', 'สัญลักษณ์ต้นฉบับ/สำเนา')}{sw('header_bg', 'พื้นหลังหัวตาราง')}{sw('logo', 'โลโก้')}{sw('stamp', 'ตรายาง')}</fieldset>
      <fieldset style={{ display: 'grid', gap: 8 }}><legend>หัวเอกสาร</legend>
        <label>ชื่อหัวเอกสาร{adv ? '' : ' (ตั้งแยกชนิดได้ในโหมดขั้นสูง)'}<input list="titles" value={base.title} disabled={!canWrite || !adv} placeholder="ใช้ชื่อมาตรฐานของชนิดเอกสาร" onChange={e => set('title', e.target.value)} />
          <datalist id="titles">{(TITLE_PRESETS[type] ?? []).map(t => <option key={t} value={t} />)}</datalist></label>
        <label>ชื่อช่องผู้ซื้อ<input value={base.customer_label} disabled={!canWrite} placeholder="ลูกค้า" onChange={e => set('customer_label', e.target.value)} /></label>
        {sw('show_credit', 'แสดงเครดิต')}{sw('show_due', 'แสดงวันครบกำหนด')}</fieldset>
      {canWrite && <div className="acts" style={{ justifyContent: 'flex-start', gap: 8 }}><button type="button" className="btn" disabled={pending} onClick={save}>บันทึกข้อมูล</button>
        <button type="button" className="btn ghost" disabled={pending} onClick={reset}>รีเซ็ตรูปแบบดีไซน์เอกสาร</button>{msg && <span className="sub" role="status">{msg}</span>}</div>}
    </div>
  );
}
