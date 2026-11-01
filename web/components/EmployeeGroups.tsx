'use client';
import Link from 'next/link';
import { Fragment, useState } from 'react';
import { Pill } from '@/components/Pill';

const m = (n: number) => Number(n ?? 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export type Row = { no: string; href?: string; date: string; party: string; sub?: string | null; net: number; status: string; pdf?: boolean };
export type Grp = { name: string; label: string; net: number; rows: Row[] };

/** กลุ่มตามพนักงาน/ผู้ทำรายการ กดแถวกลุ่มเพื่อกางเอกสาร (แบบ FA) · เมนูสามจุดต่อเอกสาร: พิมพ์/ดาวน์โหลด · ใบที่ยกเลิกจางและไม่นับยอด */
export function EmployeeGroups({ groups, cols, netLabel }: { groups: Grp[]; cols: [string, string, string]; netLabel: string }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const tog = (k: string) => setOpen(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  return (
    <table><thead><tr><th>{cols[0]}</th><th>วันที่</th><th>{cols[1]}</th><th className="num">{netLabel}</th><th>สถานะ</th><th className="noprint" /></tr></thead>
      {groups.map(g => (
        <tbody key={g.name}>
          <tr data-group style={{ background: 'var(--panel2, rgba(0,0,0,.03))' }}>
            <td colSpan={3}><button className="xp" onClick={() => tog(g.name)} aria-expanded={open.has(g.name)}>{open.has(g.name) ? '▾' : '▸'}</button> <b>{g.label}</b></td>
            <td className="num"><b>{m(g.net)}</b></td><td colSpan={2} /></tr>
          {open.has(g.name) && g.rows.map(r => (
            <tr key={r.no} className="dl-sub" style={r.status === 'cancelled' ? { opacity: 0.5 } : undefined}>
              <td className="no">{r.href ? <Link href={r.href}>{r.no}</Link> : r.no}</td><td>{r.date}</td>
              <td>{r.party}{r.sub && <div className="sub">{r.sub}</div>}</td><td className="num">{m(r.net)}</td><td><Pill s={r.status} /></td>
              <td className="noprint">{r.pdf && r.href && <details style={{ position: 'relative' }}><summary className="btn sm ghost" style={{ listStyle: 'none', cursor: 'pointer' }}>⋯</summary>
                <div className="panel" style={{ position: 'absolute', right: 0, zIndex: 5, minWidth: 150, padding: 6, display: 'grid', gap: 4 }}>
                  <a className="btn sm ghost" href={`${r.href}/pdf`} target="_blank">พิมพ์เอกสาร</a>
                  <a className="btn sm ghost" href={`${r.href}/pdf?download=1`}>ดาวน์โหลด</a></div></details>}</td></tr>))}
        </tbody>))}
      {groups.length === 0 && <tbody><tr><td colSpan={6} className="empty">ไม่มีข้อมูลในช่วงที่เลือก</td></tr></tbody>}
    </table>
  );
}
