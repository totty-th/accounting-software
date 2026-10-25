'use client';
import Link from 'next/link';
import { Fragment, useState } from 'react';
import { Pill } from '@/components/Pill';

export type DocLine = { d: string; q?: string; net: number; vat?: number; tag?: string };
export type DocRow = { key: string; href: string; no: string; date: string; party: string; kind?: string; net: number; vat: number; total: number; status: string; dim?: boolean; lines: DocLine[] };
const m = (n: number) => Number(n ?? 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** ตารางรายงานรายเอกสาร กดลูกศรเพื่อขยายดูรายการย่อย (แบบ FA) */
export function DocRows({ rows, partyLabel, kindLabel, vatLabel }: { rows: DocRow[]; partyLabel: string; kindLabel?: string; vatLabel: string }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const tog = (k: string) => setOpen(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const allOpen = rows.length > 0 && open.size === rows.length;
  const cols = kindLabel ? 8 : 7;
  return (
    <table><thead><tr>
      <th><button className="xp" onClick={() => setOpen(allOpen ? new Set() : new Set(rows.map(r => r.key)))} aria-label="ขยาย/ย่อทั้งหมด">{allOpen ? '▾' : '▸'}</button>เลขที่เอกสาร</th>
      <th>วันที่</th><th>{partyLabel}</th>{kindLabel && <th>{kindLabel}</th>}<th className="num">มูลค่า</th><th className="num">{vatLabel}</th><th className="num">ยอดรวมสุทธิ</th><th>สถานะ</th></tr></thead>
      <tbody>{rows.map(r => (
        <Fragment key={r.key}>
          <tr style={r.dim ? { opacity: .55 } : undefined}>
            <td className="no"><button className="xp" onClick={() => tog(r.key)} aria-label={`ดูรายการ ${r.no}`} aria-expanded={open.has(r.key)}>{open.has(r.key) ? '▾' : '▸'}</button><Link href={r.href}>{r.no}</Link></td>
            <td>{r.date}</td><td>{r.party}</td>{kindLabel && <td>{r.kind}</td>}
            <td className="num">{m(r.net)}</td><td className="num">{m(r.vat)}</td><td className="num">{m(r.total)}</td><td><Pill s={r.status} /></td></tr>
          {open.has(r.key) && (r.lines.length === 0
            ? <tr className="dl-sub"><td colSpan={cols} className="sub">ไม่มีรายการ</td></tr>
            : r.lines.map((l, i) => <tr key={i} className="dl-sub"><td /><td colSpan={kindLabel ? 3 : 2}>{l.tag && <span className="sub">{l.tag} · </span>}{l.d}{l.q ? <span className="sub"> · {l.q}</span> : null}</td>
              <td className="num">{m(l.net)}</td><td className="num">{l.vat != null ? m(l.vat) : ''}</td><td className="num">{l.vat != null ? m(l.net + l.vat) : ''}</td><td /></tr>))}
        </Fragment>))}</tbody></table>
  );
}
