'use client';
import { useState } from 'react';
import { REPORT_PERIODS } from '@/lib/period';
import type { StGroup } from '@/lib/report-filter';

/** ตัวกรองรายงานแบบ FA: ช่วงเวลา (เลือกช่วงวันที่ → ขึ้นช่องวันที่) + สถานะเลือกหลายค่าแยกกลุ่ม + ปุ่มแสดงผล */
export function ReportFilter({ period, from, to, groups, selected, name = 'st', allLabel = 'สถานะทั้งหมด', hidden = {}, selects = [] }:
  { selects?: { name: string; label: string; value: string; options: [string, string][] }[]; period: string; from?: string; to?: string; groups?: StGroup[]; selected?: string[]; name?: string; allLabel?: string; hidden?: Record<string, string> }) {
  const [p, setP] = useState(period);
  const [sel, setSel] = useState<string[]>(selected ?? []);
  const toggle = (v: string) => setSel(s => s.includes(v) ? s.filter(x => x !== v) : [...s, v]);
  const label = sel.length === 0 ? allLabel : `เลือก ${sel.length} สถานะ`;
  return (
    <form className="row-inline rf" method="get">
      {Object.entries(hidden).map(([k, v]) => v ? <input key={k} type="hidden" name={k} value={v} /> : null)}
      <label className="f">ช่วงเวลา<select name="period" value={p} onChange={e => setP(e.target.value)}>{REPORT_PERIODS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      {p === 'custom' && <>
        <label className="f">วันที่เริ่มต้น<input type="date" name="from" defaultValue={from ?? ''} required /></label>
        <label className="f">วันที่สิ้นสุด<input type="date" name="to" defaultValue={to ?? ''} required /></label></>}
      {selects.map(x => <label key={x.name} className="f">{x.label}<select name={x.name} defaultValue={x.value}>{x.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>)}
      {groups && <div className="f msel"><span>{name === 'ch' ? 'ช่องทาง' : 'สถานะ'}</span>
        <details><summary>{label} ▾</summary>
          <div className="msel-pop">
            <label><input type="checkbox" checked={sel.length === 0} onChange={() => setSel([])} /> {allLabel}</label>
            {groups.map(g => <div key={g.label}>{g.label && <div className="msel-h">{g.label}</div>}
              {g.options.map(([v, l]) => <label key={v}><input type="checkbox" name={name} value={v} checked={sel.includes(v)} onChange={() => toggle(v)} /> {l}</label>)}</div>)}
          </div></details></div>}
      <button className="btn" type="submit">แสดงผล</button>
    </form>
  );
}
