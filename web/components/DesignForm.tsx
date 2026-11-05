'use client';
import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { saveDocDesign, resetDocDesign } from '@/lib/actions';
import { DEFAULT_DESIGN, DESIGN_TYPES, FONT_TH, FORMAT_TH, TITLE_PRESETS, type DocDesign } from '@/lib/doc-design';
import { DocSheet } from '@/components/DocSheet';
import type { DocView } from '@/lib/doc-view';

type Rows = Record<string, Partial<DocDesign>>;
/** แสดงเอกสารบนกระดาษขนาดจริง (A4 210×297 มม. / ต่อเนื่อง 215.9×279.4 มม.) ย่อให้พอดีความกว้างกรอบ */
function Paper({ cont, children }: { cont: boolean; children: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null); const [w, setW] = useState(0);
  useEffect(() => { const el = box.current; if (!el) return; const ro = new ResizeObserver(() => setW(el.clientWidth)); ro.observe(el); setW(el.clientWidth); return () => ro.disconnect(); }, []);
  const pw = cont ? 816 : 794, ph = cont ? 1056 : 1123;   // px ที่ 96 dpi
  const k = w > 0 ? Math.min(1, w / pw) : 1;
  return (
    <div ref={box} style={{ width: '100%', background: '#e6e8ee', padding: 10, borderRadius: 6, boxSizing: 'border-box' }}>
      <div style={{ width: pw * k, height: ph * k, margin: '0 auto', background: '#fff', boxShadow: '0 2px 10px rgba(0,0,0,.25)', overflow: 'hidden', position: 'relative' }}>
        <div className="paper-pv" style={{ width: pw, height: ph, transform: `scale(${k})`, transformOrigin: 'top left', padding: cont ? '10mm' : '12mm', boxSizing: 'border-box', overflow: 'hidden', ['--pg' as any]: 1 }}>{children}</div>
      </div>
    </div>);
}
/** ตั้งค่ารูปแบบดีไซน์เอกสาร: เรียบง่าย = ใช้กับทุกเอกสาร · ขั้นสูง = ตั้งแยกชนิดเอกสาร (ทับค่าเรียบง่าย) */
export function DesignForm({ init, canWrite, samples = {} }: { init: Rows; canWrite: boolean; samples?: Record<string, DocView> }) {
  const r = useRouter(); const [pending, start] = useTransition();
  const [adv, setAdv] = useState(Object.keys(init).some(k => k !== 'all'));
  const [type, setType] = useState('INV');
  const [rows, setRows] = useState<Rows>(init);
  const [msg, setMsg] = useState<string | null>(null);
  const [copy, setCopy] = useState(false);
  const scope = adv ? type : 'all';
  const pt = adv ? type : (samples.INV ? 'INV' : Object.keys(samples)[0]);   // ชนิดเอกสารที่ใช้เป็นตัวอย่าง
  const base = { ...DEFAULT_DESIGN, ...(adv ? init.all ?? {} : {}), ...(rows[scope] ?? {}) } as DocDesign;
  const set = <K extends keyof DocDesign>(k: K, v: DocDesign[K]) => setRows(o => ({ ...o, [scope]: { ...(o[scope] ?? {}), [k]: v } }));
  const sw = (k: 'bw' | 'copy_mark' | 'header_bg' | 'logo' | 'stamp' | 'show_credit' | 'show_due', label: string) =>
    <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={base[k]} disabled={!canWrite} onChange={e => set(k, e.target.checked)} /> {label}</label>;
  const save = () => start(async () => { const x = await saveDocDesign(scope, { ...DEFAULT_DESIGN, ...(rows[scope] ?? {}) }); setMsg(x.error ?? 'บันทึกรูปแบบเอกสารแล้ว (มีผลกับเอกสารทั้งหมดที่พิมพ์/แชร์ รวมที่สร้างไว้ก่อนหน้า)'); if (!x.error) r.refresh(); });
  const reset = () => start(async () => { if (!window.confirm('รีเซ็ตรูปแบบดีไซน์เอกสารทั้งหมดกลับค่าเริ่มต้น?')) return; const x = await resetDocDesign(); if (x.error) setMsg(x.error); else { setRows({}); setAdv(false); setMsg('รีเซ็ตแล้ว'); r.refresh(); } });
  const sample = pt ? samples[pt] : undefined;
  return (
    <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,420px),1fr))', alignItems: 'start' }}>
    <div className="panel" style={{ display: 'grid', gap: 10, maxWidth: 640 }}>
      <div className="acts" style={{ justifyContent: 'flex-start', gap: 8 }}><b>โหมดการใช้งาน</b>
        <button type="button" className={`chip${!adv ? ' on' : ''}`} onClick={() => setAdv(false)}>เรียบง่าย</button>
        <button type="button" className={`chip${adv ? ' on' : ''}`} onClick={() => setAdv(true)}>ขั้นสูง</button></div>
      <p className="sub">{adv ? 'ตั้งแยกตามชนิดเอกสาร — ค่าที่ไม่ได้ตั้งเฉพาะชนิดจะใช้ค่าของโหมดเรียบง่าย' : 'ตั้งครั้งเดียวใช้กับทุกเอกสารขาย'}</p>
      {adv && <label>ชนิดเอกสาร<select value={type} onChange={e => setType(e.target.value)}>{DESIGN_TYPES.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></label>}
      <fieldset style={{ display: 'grid', gap: 8 }}><legend>รูปแบบหน้าตาเอกสาร (PDF)</legend>
        <label>เลย์เอาต์<select value={base.layout} disabled={!canWrite} onChange={e => set('layout', e.target.value as DocDesign['layout'])}>
          <option value="standard">มาตรฐาน</option><option value="branded">แบรนด์ (โลโก้กลางหัวเอกสาร กล่องลูกค้า ตราประทับ/ผู้ลงนามท้ายเอกสาร)</option></select></label>
        {base.layout === 'branded' && <>
          <label>รหัสแบบฟอร์ม (แสดงท้ายหน้า เช่น FM-SA-01-01 Rev.01)<input value={base.form_code} maxLength={40} disabled={!canWrite} onChange={e => set('form_code', e.target.value)} /></label>
          <span className="sub">แบบแบรนด์ใช้กับกระดาษ A4 · ตั้งโลโก้ ตรายาง ลายเซ็น อีเมล และชื่อผู้ลงนามที่ ตั้งค่า → ข้อมูลบริษัท · ชื่อผู้ติดต่อ/เบอร์ลูกค้าดึงจากรายชื่อลูกค้า</span></>}
      </fieldset>
      <fieldset style={{ display: 'grid', gap: 8 }}><legend>รูปแบบกระดาษ</legend>
        <div className="acts" style={{ justifyContent: 'flex-start', gap: 16 }}><b>ขนาด</b>
          <label><input type="radio" checked={base.paper === 'a4'} disabled={!canWrite} onChange={() => set('paper', 'a4')} /> A4</label>
          <label><input type="radio" checked={base.paper === 'continuous'} disabled={!canWrite} onChange={() => set('paper', 'continuous')} /> กระดาษต่อเนื่อง</label></div>
        {base.paper === 'continuous' && <>
          <label>รูปแบบ<select value={base.paper_format} disabled={!canWrite} onChange={e => set('paper_format', e.target.value as DocDesign['paper_format'])}>{Object.entries(FORMAT_TH).map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></label>
          {base.paper_format === 'printshop' && <div className="sub" style={{ display: 'grid', gap: 6 }}>
            <span>เอกสารจะพิมพ์เฉพาะข้อมูลลงกระดาษแบบฟอร์มสำเร็จรูปที่สั่งพิมพ์จากโรงพิมพ์ (ไม่พิมพ์เส้น/ป้ายชื่อช่อง/ข้อมูลบริษัท)</span>
            <span>ดาวน์โหลดแม่แบบส่งโรงพิมพ์: {DESIGN_TYPES.filter(([k]) => k !== 'BL').map(([k, n]) => <a key={k} href={`/settings/design/template/${k}`} target="_blank" rel="noreferrer" style={{ marginRight: 10 }}>{n}</a>)}</span>
            <span>ไม่รองรับ: ใบแจ้งหนี้มัดจำ/เอกสารที่หักมัดจำ และใบวางบิล (พิมพ์ด้วยรูปแบบมาตรฐานแทน) · ต้องบันทึกก่อนจึงจะเห็นผลที่ปุ่มพิมพ์/PDF</span></div>}
          {base.paper_format === 'carbon' && <span className="sub">กระดาษคาร์บอน: รูปแบบขาว-ดำเหมือนมาตรฐาน (FA แสดงตัวอย่างเหมือนกัน)</span>}</>}
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
    <div className="panel" style={{ minWidth: 0 }}>
      <div className="acts" style={{ justifyContent: 'space-between', gap: 8, marginBottom: 8 }}><b>ตัวอย่างเอกสาร (ดูผลทันทีก่อนบันทึก)</b>
        <span><button type="button" className={`chip${!copy ? ' on' : ''}`} onClick={() => setCopy(false)}>ต้นฉบับ</button> <button type="button" className={`chip${copy ? ' on' : ''}`} onClick={() => setCopy(true)}>สำเนา</button></span></div>
      {sample ? <>
        <p className="sub">ใช้ข้อมูลจากเอกสารจริงล่าสุดของชนิดนี้ ({sample.doc.doc_no}) · {base.paper === 'continuous' ? `กระดาษต่อเนื่อง 8.5×11 นิ้ว (${FORMAT_TH[base.paper_format]}) · ขาว-ดำ` + (base.paper_format === 'printshop' ? ' · แบบโรงพิมพ์พิมพ์เฉพาะข้อมูลลงแบบฟอร์ม ดูผลที่ PDF หลังบันทึก' : '') : 'A4: ตอนพิมพ์ตั้งหน้ากระดาษ A4 ขอบ 12 มม.'}</p>
        <Paper cont={base.paper === 'continuous'}><DocSheet v={{ ...sample, design: base }} copy={copy} /></Paper></>
        : <p className="sub">ยังไม่มีเอกสารชนิดนี้ให้เป็นตัวอย่าง — สร้างเอกสารสักใบก่อนเพื่อดูตัวอย่าง</p>}
    </div>
    </div>
  );
}
