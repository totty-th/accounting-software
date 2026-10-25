'use client';
import { useState } from 'react';

/** ปุ่มดาวน์โหลด Excel / พิมพ์รายงาน — อ่านตารางที่แสดงอยู่ (รวมแถวที่ขยายไว้) แล้วส่งไปสร้างไฟล์ */
export function ReportTools({ title, meta = [], exportBase, modes }: { title: string; meta?: [string, string][]; exportBase?: string; modes?: [string, string][] }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const xlsx = async () => {
    const t = document.querySelector<HTMLTableElement>('[data-report] table'); if (!t) { setErr('ไม่มีข้อมูลให้ดาวน์โหลด'); return; }
    const txt = (c: Element) => (c as HTMLElement).innerText.replace(/[▸▾]/g, '').replace(/\s+/g, ' ').trim();
    const head = [...t.querySelectorAll('thead th')].map(txt);
    const rows = [...t.querySelectorAll('tbody tr')].map(tr => {
      const cells: string[] = []; tr.querySelectorAll('td').forEach(td => { cells.push(txt(td)); for (let i = 1; i < (td.colSpan || 1); i++) cells.push(''); });
      return { cells, bold: tr.hasAttribute('data-group'), sub: tr.classList.contains('dl-sub') };
    });
    setBusy(true); setErr('');
    try {
      const r = await fetch('/reports/xlsx', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title, meta, head, rows }) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? 'ดาวน์โหลดไม่สำเร็จ');
      const a = document.createElement('a'); a.href = URL.createObjectURL(await r.blob()); a.download = `${title}_${new Date().toISOString().slice(0, 10)}.xlsx`; a.click(); URL.revokeObjectURL(a.href);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="noprint" style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '0 0 10px', flexWrap: 'wrap' }}>
      {exportBase
        ? (modes ?? [['', 'ดาวน์โหลด Excel']]).map(([m, l]) => <button key={m} className="btn sm ghost" onClick={() => {
            const u = new URL(window.location.href); const q = new URLSearchParams(u.search); if (m) q.set('mode', m); else q.delete('mode'); q.delete('view'); q.delete('doc');
            window.location.href = `${exportBase}?${q}`; }}>⬇ {l}</button>)
        : <button className="btn sm ghost" disabled={busy} onClick={xlsx}>⬇ ดาวน์โหลด Excel</button>}
      <button className="btn sm" onClick={() => window.print()}>🖨 พิมพ์รายงาน</button>
      {err && <span style={{ color: 'var(--red)' }}>{err}</span>}
    </div>
  );
}
