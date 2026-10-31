'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { filePp30, payPp30, filePp36, payPp36 } from '@/lib/actions';
import { dateTh } from '@/lib/format';

export type Pp30Doc = { type: string; id: string; date: string; inv: string; vendor: string; vat: number; form: 'PP30' | 'PP36'; rd?: string };

/** เตรียมแบบ ภ.พ.30 (แบบ FA): ภาษีขายของเดือนอัตโนมัติ · ติ๊กเลือกใบกำกับภาษีซื้อที่จะใช้สิทธิ์ · ยื่นซ้ำเดือนเดิมได้ (ยื่นเพิ่มเติม) */
export function Pp30Create({ month, docs, outputVat }: { month: string; docs: Pp30Doc[]; outputVat: number }) {
  const r = useRouter(); const [sel, setSel] = useState<string[]>([]); const [err, setErr] = useState<string | null>(null); const [p, start] = useTransition();
  const key = (d: Pp30Doc) => `${d.type}:${d.id}`;
  const chosen = docs.filter(d => sel.includes(key(d)));
  const inp = Math.round(chosen.reduce((s, d) => s + d.vat, 0) * 100) / 100, net = Math.round((outputVat - inp) * 100) / 100;
  const f = (n: number) => n.toLocaleString('th-TH', { minimumFractionDigits: 2 });
  return (
    <div className="panel" style={{ padding: 0, overflowX: 'auto' }}>
      <table><thead><tr><th style={{ width: 30 }}><input type="checkbox" aria-label="เลือกทั้งหมด" checked={docs.length > 0 && sel.length === docs.length} onChange={e => setSel(e.target.checked ? docs.map(key) : [])} /></th>
        <th>วันที่ใบกำกับ</th><th>เลขที่ใบกำกับ</th><th>ผู้จำหน่าย</th><th>แบบ</th><th className="num">ภาษีมูลค่าเพิ่ม</th></tr></thead>
        <tbody>{docs.map(d => <tr key={key(d)}><td><input type="checkbox" aria-label={`เลือก ${d.inv}`} checked={sel.includes(key(d))} onChange={e => setSel(e.target.checked ? [...sel, key(d)] : sel.filter(x => x !== key(d)))} /></td>
          <td>{dateTh(d.date)}</td><td className="no">{d.inv}{d.rd && <small> · ใบเสร็จ {d.rd}</small>}</td><td>{d.vendor}</td><td>{d.form === 'PP36' ? 'ภ.พ.36' : 'ภ.พ.30'}</td><td className="num">{f(d.vat)}</td></tr>)}
          {docs.length === 0 && <tr><td colSpan={6} className="empty">ไม่มีใบกำกับภาษีซื้อที่รอใช้สิทธิ์ในเดือนนี้ (รับใบกำกับที่หน้า จัดการเอกสารภาษีซื้อ · ภ.พ.36 ต้องชำระและบันทึกใบเสร็จสรรพากรก่อน)</td></tr>}</tbody></table>
      <div style={{ padding: 10, display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <span>ภาษีขายที่ยังไม่ยื่น {f(outputVat)}</span><span>ภาษีซื้อที่เลือก {f(inp)}</span><b>{net >= 0 ? `ภาษีที่ต้องชำระ ${f(net)}` : `ภาษีที่ขอคืน ${f(-net)}`}</b>
        <button className="btn" disabled={p || (chosen.length === 0 && outputVat === 0)} onClick={() => start(async () => { const x = await filePp30(month, chosen.map(d => ({ type: d.type, id: d.id }))); if (x.error) setErr(x.error); else { setErr(null); setSel([]); r.refresh(); } })}>บันทึกแบบยื่นภาษี</button>
        {err && <span className="err" role="alert">{err}</span>}</div>
    </div>
  );
}
export function Pp30Pay({ id, accounts, defaultDate, kind = '30' }: { kind?: '30' | '36'; id: string; accounts: { code: string; name: string }[]; defaultDate: string }) {
  const r = useRouter(); const [open, setOpen] = useState(false); const [d, setD] = useState(defaultDate); const [a, setA] = useState(accounts[0]?.code ?? '');
  const [err, setErr] = useState<string | null>(null); const [p, start] = useTransition();
  if (!open) return <button className="btn sm" onClick={() => setOpen(true)}>บันทึกชำระ</button>;
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      <input type="date" value={d} onChange={e => setD(e.target.value)} aria-label="วันที่ชำระ" />
      <select value={a} onChange={e => setA(e.target.value)} aria-label="ชำระจากบัญชี">{accounts.map(x => <option key={x.code} value={x.code}>{x.code} {x.name}</option>)}</select>
      <button className="btn sm" disabled={p} onClick={() => start(async () => { const x = await (kind === '36' ? payPp36 : payPp30)(id, d, a); if (x.error) setErr(x.error); else { setErr(null); setOpen(false); r.refresh(); } })}>ยืนยัน</button>
      <button className="btn sm ghost" onClick={() => setOpen(false)}>ยกเลิก</button>
      {err && <span className="err" role="alert">{err}</span>}</div>
  );
}

/** เตรียมแบบ ภ.พ.36: ติ๊กใบกำกับ ภ.พ.36 ของเดือน → สรุปฐาน/ภาษี → ยื่นแบบ */
export function Pp36Create({ month, docs }: { month: string; docs: { type: string; id: string; date: string; inv: string; vendor: string; base: number; vat: number }[] }) {
  const r = useRouter(); const [sel, setSel] = useState<string[]>([]); const [err, setErr] = useState<string | null>(null); const [p, start] = useTransition();
  const key = (d: { type: string; id: string }) => `${d.type}:${d.id}`;
  const chosen = docs.filter(d => sel.includes(key(d)));
  const base = chosen.reduce((s, d) => s + d.base, 0), vat = Math.round(chosen.reduce((s, d) => s + d.vat, 0) * 100) / 100;
  const f = (n: number) => n.toLocaleString('th-TH', { minimumFractionDigits: 2 });
  return (
    <div className="panel" style={{ padding: 0, overflowX: 'auto' }}>
      <table><thead><tr><th style={{ width: 30 }}><input type="checkbox" aria-label="เลือกทั้งหมด" checked={docs.length > 0 && sel.length === docs.length} onChange={e => setSel(e.target.checked ? docs.map(key) : [])} /></th>
        <th>วันที่ใบกำกับ</th><th>เลขที่ใบกำกับ</th><th>ผู้จำหน่าย</th><th className="num">มูลค่าที่จ่ายจริง</th><th className="num">ภาษีมูลค่าเพิ่ม (7%)</th></tr></thead>
        <tbody>{docs.map(d => <tr key={key(d)}><td><input type="checkbox" aria-label={`เลือก ${d.inv}`} checked={sel.includes(key(d))} onChange={e => setSel(e.target.checked ? [...sel, key(d)] : sel.filter(x => x !== key(d)))} /></td>
          <td>{dateTh(d.date)}</td><td className="no">{d.inv}</td><td>{d.vendor}</td><td className="num">{f(d.base)}</td><td className="num">{f(d.vat)}</td></tr>)}
          {docs.length === 0 && <tr><td colSpan={6} className="empty">ไม่มีใบกำกับแบบ ภ.พ.36 ที่รอยื่นในเดือนนี้ (บันทึกที่หน้า จัดการเอกสารภาษีซื้อ)</td></tr>}</tbody></table>
      <div style={{ padding: 10, display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <span>ยอดซื้อต่างประเทศที่เลือก {f(base)}</span><b>ภาษีที่ต้องชำระ {f(vat)}</b>
        <button className="btn" disabled={p || chosen.length === 0} onClick={() => start(async () => { const x = await filePp36(month, chosen.map(d => ({ type: d.type, id: d.id }))); if (x.error) setErr(x.error); else { setErr(null); setSel([]); r.refresh(); } })}>บันทึกแบบยื่นภาษี</button>
        {err && <span className="err" role="alert">{err}</span>}</div>
    </div>
  );
}
