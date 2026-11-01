'use client';
import Link from 'next/link';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { bulkPurchaseVatStatus } from '@/lib/actions';
import { VatStatusCell } from '@/components/VatStatusCell';
import { VAT_KEYS } from '@/lib/vat-status';

export interface VatRow { kind: string; id: string; href: string; no: string; dateTxt: string; docDate: string; inv_no: string | null; name: string; baseTxt: string; vatTxt: string;
  st: string; filed: boolean; stage: string; rd: string; form: string; docTotal: number; key: string }
const dot = (k: string) => VAT_KEYS.find(x => x[0] === k)?.[2] ?? '#9aa0a6';

/** ตารางจัดการเอกสารภาษีซื้อ: เลือกหลายรายการแล้ว "เปลี่ยนสถานะ" (ไม่ใช้สิทธิขอคืน / รอใบกำกับภาษี) · จุดสีหน้าเลขที่เอกสารตามสถานะ */
export function VatTable({ rows, totalTxt, canWrite }: { rows: VatRow[]; totalTxt: string; canWrite: boolean }) {
  const r = useRouter();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState(false); const [err, setErr] = useState<string | null>(null); const [p, start] = useTransition();
  const k = (x: VatRow) => `${x.kind}:${x.id}`;
  const editable = rows.filter(x => !x.filed);
  const toggle = (x: VatRow) => setSel(s => { const n = new Set(s); n.has(k(x)) ? n.delete(k(x)) : n.add(k(x)); return n; });
  const all = editable.length > 0 && editable.every(x => sel.has(k(x)));
  const go = (status: 'waived' | 'wait') => start(async () => {
    const items = rows.filter(x => sel.has(k(x))).map(x => ({ type: x.kind, id: x.id }));
    const x = await bulkPurchaseVatStatus(items, status);
    if (x.error) setErr(x.error); else { setErr(null); setSel(new Set()); setMenu(false); r.refresh(); } });
  return (
    <>
      {canWrite && sel.size > 0 && (
        <div className="noprint" style={{ padding: '8px 10px', display: 'flex', gap: 10, alignItems: 'center', background: 'var(--bg2, #eef3fb)', position: 'relative' }}>
          <button className="btn sm ghost" onClick={() => setSel(new Set())}>✕</button><span>{sel.size} รายการ</span>
          <button className="btn sm" disabled={p} onClick={() => setMenu(m => !m)}>⇄ เปลี่ยนสถานะ</button>
          {menu && <div className="panel" style={{ position: 'absolute', top: 40, left: 120, zIndex: 5, padding: 6, display: 'grid', gap: 4 }}>
            <small style={{ color: 'var(--muted)' }}>สถานะที่เปลี่ยนได้</small>
            <button className="btn sm ghost" disabled={p} onClick={() => r.push(`/tax/purchase-vat/receive?ids=${[...sel].join(',')}`)}>รับใบกำกับภาษี</button>
            <button className="btn sm ghost" disabled={p} onClick={() => go('waived')}>ไม่ใช้สิทธิขอคืน</button>
            <button className="btn sm ghost" disabled={p} onClick={() => go('wait')}>รอใบกำกับภาษี</button>
</div>}
          {err && <span className="err" role="alert">{err}</span>}
        </div>)}
      <table><thead><tr>{canWrite && <th style={{ width: 28 }}><input type="checkbox" aria-label="เลือกทั้งหมด" checked={all} onChange={() => setSel(all ? new Set() : new Set(editable.map(k)))} /></th>}
        <th>วันที่เอกสาร</th><th>เลขที่เอกสาร</th><th>ผู้จำหน่าย</th><th className="num">มูลค่า / ภาษีมูลค่าเพิ่ม</th><th>สถานะใบกำกับภาษี</th></tr></thead>
        <tbody>{rows.map(x => <tr key={k(x)}>
          {canWrite && <td>{!x.filed && <input type="checkbox" aria-label={`เลือก ${x.no}`} checked={sel.has(k(x))} onChange={() => toggle(x)} />}</td>}
          <td>{x.dateTxt}</td>
          <td className="no"><span title={VAT_KEYS.find(v => v[0] === x.key)?.[1]} style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 5, background: dot(x.key), marginRight: 6 }} /><Link href={x.href}>{x.no}</Link>{x.inv_no && <div className="sub">{x.inv_no}</div>}</td>
          <td>{x.name}</td>
          <td className="num">{x.baseTxt}<div className="sub">{x.vatTxt}</div></td>
          <td><VatStatusCell type={x.kind} id={x.id} status={x.st} filed={x.filed} stage={x.stage} rd={x.rd} form={x.form} invNo={x.inv_no ?? ''} docDate={x.docDate} docTotal={x.docTotal} canWrite={canWrite} /></td></tr>)}
          {rows.length === 0 && <tr><td colSpan={canWrite ? 6 : 5} className="empty">ไม่พบเอกสาร</td></tr>}
          <tr style={{ fontWeight: 700 }}><td colSpan={canWrite ? 4 : 3}>ยอดรวมภาษีซื้อทั้งหมด</td><td className="num">{totalTxt}</td><td /></tr></tbody></table>
    </>
  );
}
