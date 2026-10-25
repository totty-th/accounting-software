'use client';
import Link from 'next/link';
import { Fragment, useState } from 'react';

export type PayRow = { key: string; href: string; no: string; date: string; party: string; payDate: string; detail: string; net: number; paid: number };
export type PayGroup = { key: string; label: string; net: number; paid: number; rows: PayRow[] };
const m = (n: number) => Number(n ?? 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** รายงานการชำระเงิน: จัดกลุ่มตามช่องทาง กดลูกศรขยายดูเอกสารที่จ่ายผ่านช่องทางนั้น */
export function PayGroups({ groups }: { groups: PayGroup[] }) {
  const [open, setOpen] = useState<Set<string>>(new Set(groups.map(g => g.key)));
  const tog = (k: string) => setOpen(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  return (
    <table><thead><tr><th>เลขที่เอกสาร</th><th>วันที่</th><th>ชื่อผู้จำหน่าย</th><th>วันที่ชำระ</th><th>รายละเอียดการชำระ</th><th className="num">ยอดรวมสุทธิ</th><th className="num">ยอดชำระ</th></tr></thead>
      <tbody>{groups.map(g => (
        <Fragment key={g.key}>
          <tr data-group style={{ background: 'rgba(127,127,127,.1)', fontWeight: 600 }}>
            <td colSpan={5}><button className="xp" onClick={() => tog(g.key)} aria-expanded={open.has(g.key)}>{open.has(g.key) ? '▾' : '▸'}</button>{g.label} <span className="sub">({g.rows.length} รายการ)</span></td>
            <td className="num">{m(g.net)}</td><td className="num">{m(g.paid)}</td></tr>
          {open.has(g.key) && g.rows.map(r => <tr key={r.key}>
            <td className="no"><Link href={r.href}>{r.no}</Link></td><td>{r.date}</td><td>{r.party}</td><td>{r.payDate}</td><td>{r.detail}</td>
            <td className="num">{m(r.net)}</td><td className="num">{m(r.paid)}</td></tr>)}
        </Fragment>))}</tbody></table>
  );
}
