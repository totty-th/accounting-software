'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { RelPop } from '@/components/TaxBits';

export interface DocRow { id: string; href: string; date: string; no: string; party: string; detail?: string; due?: string; total: number;
  status: string; label: string; tone: string; pdf?: string; flag?: string; rel?: { no: string; kind: string; href: string }[] }
const TONE: Record<string, string> = { green: 'var(--green)', orange: 'var(--orange)', blue: 'var(--blue)', purple: 'var(--purple)', red: 'var(--red)', grey: 'var(--grey)', teal: 'var(--teal)' };
const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** รายการเอกสารแบบ FA: แถวเดียวต่อเอกสาร มีจุดสีสถานะ คลิกแถวเข้าหน้าเอกสาร · ค้นหา · กรองสถานะ · แบ่งหน้า */
export function DocList({ rows, partyLabel = 'ผู้จำหน่าย', detailLabel = 'รายการ', showDue = false, empty }: {
  rows: DocRow[]; partyLabel?: string; detailLabel?: string; showDue?: boolean; empty: string }) {
  const router = useRouter();
  const [q, setQ] = useState(''); const [st, setSt] = useState(''); const [per, setPer] = useState(20); const [page, setPage] = useState(1);
  const statuses = useMemo(() => { const m = new Map<string, { label: string; n: number }>();
    rows.forEach(r => m.set(r.status, { label: r.label, n: (m.get(r.status)?.n ?? 0) + 1 })); return [...m]; }, [rows]);
  const f = useMemo(() => rows.filter(r => (!st || r.status === st) &&
    (!q.trim() || [r.no, r.party, r.detail ?? ''].some(x => x.toLowerCase().includes(q.trim().toLowerCase())))), [rows, st, q]);
  const pages = Math.max(1, Math.ceil(f.length / per)); const cur = Math.min(page, pages);
  const view = f.slice((cur - 1) * per, cur * per);
  const sum = f.filter(r => r.status !== 'cancelled' && r.status !== 'rejected').reduce((a, r) => a + r.total, 0);
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
        <button type="button" className={`chip ${st === '' ? 'on' : ''}`} onClick={() => { setSt(''); setPage(1); }}>แสดงทั้งหมด ({rows.length})</button>
        {statuses.map(([k, v]) => <button type="button" key={k} className={`chip ${st === k ? 'on' : ''}`} onClick={() => { setSt(k); setPage(1); }}>{v.label} ({v.n})</button>)}
        <input aria-label="ค้นหา" placeholder="ค้นหา เลขที่เอกสาร / ชื่อ / รายการ" value={q} onChange={e => { setQ(e.target.value); setPage(1); }} style={{ marginLeft: 'auto', maxWidth: 320 }} />
      </div>
      {f.length === 0 ? <div className="panel empty">{rows.length ? 'ไม่พบเอกสารตามเงื่อนไขที่เลือก' : empty}</div> : (
        <div className="panel" style={{ padding: 0, overflowX: 'auto' }}>
          <table><thead><tr><th>วันที่</th><th>เลขที่เอกสาร</th><th>{partyLabel}</th><th>{detailLabel}</th>{showDue && <th>ครบกำหนด</th>}<th className="num">ยอดรวมสุทธิ</th><th>สถานะ</th></tr></thead>
            <tbody>{view.map(r => (
              <tr key={r.id} className="clickable" tabIndex={0} style={r.status === 'cancelled' ? { opacity: .55 } : undefined}
                onClick={e => { if ((e.target as HTMLElement).closest('a,button,input,.relpop')) return; router.push(r.href); }}
                onKeyDown={e => { if (e.key === 'Enter') router.push(r.href); }}>
                <td>{r.date}</td>
                <td className="no"><span className="dot" style={{ background: TONE[r.tone] ?? 'var(--grey)' }} />{r.no}<RelPop rel={r.rel ?? []} />{r.flag ? <span className="sub"> {r.flag}</span> : null}</td>
                <td>{r.party}</td><td style={{ maxWidth: 280, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.detail}</td>
                {showDue && <td>{r.due ?? '-'}</td>}
                <td className="num">{fmt(r.total)}</td>
                <td><span className={`pill ${r.tone}`}>{r.label}</span></td></tr>))}</tbody></table>
        </div>)}
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginTop: 12 }}>
        <span className="sub">รายการต่อหน้า <select value={per} onChange={e => { setPer(Number(e.target.value)); setPage(1); }} style={{ width: 'auto' }}>
          {[20, 50, 100].map(n => <option key={n}>{n}</option>)}</select> · {f.length} รายการ · หน้า {cur}/{pages}</span>
        <span>{cur > 1 && <button type="button" className="btn sm ghost" onClick={() => setPage(cur - 1)}>ก่อนหน้า</button>}{' '}
          {cur < pages && <button type="button" className="btn sm ghost" onClick={() => setPage(cur + 1)}>ถัดไป</button>}</span>
        <strong>ยอดรวมทั้งหมด (ไม่รวมที่ยกเลิก/ไม่อนุมัติ) {fmt(sum)}</strong>
      </div>
    </div>
  );
}
