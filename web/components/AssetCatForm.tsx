'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { saveAssetCategory } from '@/lib/actions';

export interface CatVal { id: string | null; name: string; name_en: string; depreciate: boolean; life_years: string; asset_account: string; dep_account: string; accum_account: string }
const blank: CatVal = { id: null, name: '', name_en: '', depreciate: true, life_years: '', asset_account: '', dep_account: '', accum_account: '' };
export function AssetCatForm({ cat, label }: { cat?: CatVal; label: string }) {
  const router = useRouter(); const [open, setOpen] = useState(false); const [v, setV] = useState<CatVal>(cat ?? blank); const [err, setErr] = useState<string | null>(null); const [pending, start] = useTransition();
  const set = (p: Partial<CatVal>) => setV(o => ({ ...o, ...p }));
  const rate = Number(v.life_years) > 0 ? (Math.round(10000 / Number(v.life_years)) / 100).toFixed(2) : '-';
  if (!open) return <button className="btn sm ghost" onClick={() => setOpen(true)}>{label}</button>;
  return <div className="panel" style={{ padding: 12, display: 'grid', gap: 8, minWidth: 280 }}>
    <label className="f">ชื่อหมวดหมู่ (ไทย)<input aria-label="ชื่อหมวด" value={v.name} onChange={e => set({ name: e.target.value })} /></label>
    <label className="f">ชื่อหมวดหมู่ (EN)<input aria-label="ชื่อหมวด EN" value={v.name_en} onChange={e => set({ name_en: e.target.value })} /></label>
    <label><input type="checkbox" checked={v.depreciate} onChange={e => set({ depreciate: e.target.checked })} /> คิดค่าเสื่อม</label>
    {v.depreciate && <><label className="f">อายุการใช้งาน (ปี) · อัตรา/ปี {rate}%<input aria-label="อายุ" inputMode="decimal" value={v.life_years} onChange={e => set({ life_years: e.target.value })} /></label>
      <label className="f">บัญชีค่าเสื่อมราคา (5xxxx)<input aria-label="บัญชีค่าเสื่อม" value={v.dep_account} onChange={e => set({ dep_account: e.target.value })} /></label>
      <label className="f">บัญชีค่าเสื่อมราคาสะสม (1xxxx)<input aria-label="บัญชีสะสม" value={v.accum_account} onChange={e => set({ accum_account: e.target.value })} /></label></>}
    <label className="f">บัญชีสินทรัพย์ (1xxxx)<input aria-label="บัญชีสินทรัพย์" value={v.asset_account} onChange={e => set({ asset_account: e.target.value })} /></label>
    {err && <p role="alert" className="sub" style={{ color: 'var(--red)' }}>{err}</p>}
    <div className="acts" style={{ justifyContent: 'flex-start' }}><button className="btn sm" disabled={pending} onClick={() => start(async () => {
      const r = await saveAssetCategory(v.id, { ...v }); if (r.error) setErr(r.error); else { setErr(null); setOpen(false); router.refresh(); } })}>{pending ? '...' : 'บันทึก'}</button>
      <button className="btn sm ghost" onClick={() => setOpen(false)}>ยกเลิก</button></div></div>;
}
