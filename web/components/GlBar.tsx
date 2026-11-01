'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { GL_PRESETS, GL_TYPES, thDate } from '@/lib/gl';

const clearKeys = ['m', 'month', 'year', 'from', 'to', 'q', 'type', 'page', 'cancelled'];
function Pop({ label, active, children, w = 280 }: { label: string; active?: boolean; children: (close: () => void) => React.ReactNode; w?: number }) {
  const [open, setOpen] = useState(false); const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!open) return; const f = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); }; document.addEventListener('mousedown', f); return () => document.removeEventListener('mousedown', f); }, [open]);
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" className={`btn sm${active ? '' : ' ghost'}`} aria-expanded={open} onClick={() => setOpen(!open)}>{label} ▾</button>
      {open && <div className="panel" style={{ position: 'absolute', right: 0, top: '110%', zIndex: 20, width: w, padding: 12, display: 'grid', gap: 10, boxShadow: '0 6px 24px rgba(0,0,0,.18)' }}>{children(() => setOpen(false))}</div>}
    </div>
  );
}

/** แถบตัวกรองบัญชีแยกประเภท (แบบ FA): ค้นหา · วันที่ (ทางลัด/เดือน/ปีงบ/ช่วงวันที่) · หมวดบัญชี (เลือกหลายหมวด) · ล้าง · ดาวน์โหลด */
export function GlBar({ label, from, to, mode, types = [], total, code }: { label: string; from: string; to: string; mode: 'list' | 'ledger'; types?: string[]; total: number; code?: string }) {
  const r = useRouter(); const sp = useSearchParams();
  const [q, setQ] = useState(sp.get('q') ?? '');
  const [sel, setSel] = useState<string[]>(types);
  const [rf, setRf] = useState(from), [rt, setRt] = useState(to);
  const go = (set: Record<string, string | null>, drop: string[] = []) => {
    const n = new URLSearchParams(sp.toString()); n.delete('page'); drop.forEach(k => n.delete(k));
    for (const [k, v] of Object.entries(set)) { if (v == null || v === '') n.delete(k); else n.set(k, v); }
    r.replace(`?${n}`);
  };
  const dateKeys = ['m', 'month', 'year', 'from', 'to'];
  const preset = (m: string) => go({ m }, dateKeys);
  const dateActive = sp.get('m') != null;
  const dl = (kind: 'ledger' | 'chart') => {
    const n = new URLSearchParams(sp.toString()); n.delete('page'); n.set('mode', kind);
    if (kind === 'ledger') {
      if (code) n.set('codes', code);
      else { const c = [...document.querySelectorAll<HTMLInputElement>('input[data-sel]:checked')].map(i => i.value); if (c.length) n.set('codes', c.join(',')); }
    } else { n.delete('codes'); }
    window.location.href = `/accounts/xlsx?${n}`;
  };
  const filtered = clearKeys.some(k => k !== 'cancelled' && sp.get(k));
  return (
    <div className="noprint" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', margin: '0 0 10px' }}>
      <form style={{ flex: '1 1 260px', minWidth: 200 }} onSubmit={e => { e.preventDefault(); go({ q: q.trim() }); }}>
        <input value={q} onChange={e => setQ(e.target.value)} onBlur={() => q.trim() !== (sp.get('q') ?? '') && go({ q: q.trim() })} aria-label="ค้นหา"
          placeholder={mode === 'list' ? 'ค้นหา รหัสบัญชี, ชื่อ, รายละเอียด' : 'ค้นหา เลขที่เอกสาร, คำอธิบาย, อ้างอิง, ผู้ติดต่อ'} style={{ width: '100%' }} /></form>
      <Pop label={`วันที่: ${label}`} active={dateActive} w={300}>{close => (<>
        <div className="sub">ทางลัด</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{GL_PRESETS.map(([k, l]) => <button key={k} type="button" className={`btn sm${sp.get('m') === k ? '' : ' ghost'}`} onClick={() => { preset(k); close(); }}>{l}</button>)}</div>
        <div className="sub">กำหนดเอง</div>
        <label className="f">เลือกเดือน<input type="month" value={sp.get('m') === 'month' ? sp.get('month') ?? '' : from.slice(0, 7)} onChange={e => { if (e.target.value) { go({ m: 'month', month: e.target.value }, ['year', 'from', 'to']); close(); } }} /></label>
        <label className="f">เลือกปี (ปีงบประมาณ)<input type="number" min={2000} max={2999} defaultValue={from.slice(0, 4)} onKeyDown={e => { const v = (e.target as HTMLInputElement).value; if (e.key === 'Enter' && /^\d{4}$/.test(v)) { go({ m: 'year', year: v }, ['month', 'from', 'to']); close(); } }} onBlur={e => { if (/^\d{4}$/.test(e.target.value) && e.target.value !== from.slice(0, 4)) { go({ m: 'year', year: e.target.value }, ['month', 'from', 'to']); close(); } }} /></label>
        <div className="sub">กำหนดช่วงวันที่</div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="date" style={{ minWidth: 0, flex: 1 }} value={rf} onChange={e => setRf(e.target.value)} aria-label="ตั้งแต่วันที่" /><span>ถึง</span><input type="date" style={{ minWidth: 0, flex: 1 }} value={rt} min={rf} onChange={e => setRt(e.target.value)} aria-label="ถึงวันที่" /></div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <button type="button" className="btn sm ghost" onClick={() => { go({}, dateKeys); close(); }}>ล้าง</button>
          <button type="button" className="btn sm" disabled={!rf || !rt || rf > rt} onClick={() => { go({ m: 'range', from: rf, to: rt }, ['month', 'year']); close(); }}>ตกลง</button></div>
        <div className="sub">{thDate(from)} – {thDate(to)}</div></>)}</Pop>
      {mode === 'list' && <Pop label={types.length ? `หมวดบัญชี (${types.length})` : 'หมวดบัญชี'} active={types.length > 0} w={240}>{close => (<>
        {GL_TYPES.map(([k, l]) => <label key={k} style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" style={{ width: 'auto' }} checked={sel.includes(k)} onChange={e => setSel(e.target.checked ? [...sel, k] : sel.filter(x => x !== k))} />{l}</label>)}
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><button type="button" className="btn sm ghost" onClick={() => { setSel([]); go({ type: null }); close(); }}>ล้าง</button>
          <button type="button" className="btn sm" onClick={() => { go({ type: sel.join(',') }); close(); }}>ค้นหา</button></div></>)}</Pop>}
      {mode === 'ledger' && <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" style={{ width: 'auto' }} checked={sp.get('cancelled') === '1'} onChange={e => go({ cancelled: e.target.checked ? '1' : null })} />แสดงรายการยกเลิก</label>}
      {filtered && <button type="button" className="btn sm ghost" aria-label="ล้างตัวกรองทั้งหมด" title="ล้างตัวกรองทั้งหมด" onClick={() => { setQ(''); setSel([]); go({}, clearKeys); }}>×</button>}
      <span className="sub" style={{ marginLeft: 'auto' }}>{mode === 'list' ? `ทั้งหมด ${total} รายการ` : `รายการทั้งหมด ${total} รายการ`}</span>
      {mode === 'list'
        ? <Pop label="ดาวน์โหลด" w={230}>{close => (<><button type="button" className="btn sm ghost" onClick={() => { dl('ledger'); close(); }}>บัญชีแยกประเภท (Excel)</button><div className="sub" style={{ marginTop: -4 }}>ติ๊กเลือกบัญชีในตารางก่อน หรือไม่ติ๊ก = ตามตัวกรองที่แสดง (เฉพาะบัญชีที่มีรายการ)</div><button type="button" className="btn sm ghost" onClick={() => { dl('chart'); close(); }}>โครงสร้างผังบัญชี (Excel)</button></>)}</Pop>
        : <button type="button" className="btn sm ghost" onClick={() => dl('ledger')}>⬇ ดาวน์โหลด</button>}
    </div>
  );
}
