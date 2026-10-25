'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import * as A from '@/lib/actions';
import { STATUS } from '@/lib/status';
import { RelPop } from '@/components/TaxBits';

export type QtRow = {
  rate: number; subtotal: number;
  id: string; doc_no: string; date: string; status: string; total: number; customer: string; project: string | null;
  rel: { no: string; kind: string; href: string }[];
  billing: { deposit?: boolean; total: number; billed: number; closed: number; remaining: number; percent: number;
    docs: { doc_no: string; doc_date: string; subtotal: number; total: number; status: string }[] } | null;
};
const fmt = (n: number) => Number(n ?? 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dth = (s: string) => { const [y, m, d] = s.split('-'); return `${d}/${m}/${Number(y) + 543}`; };
const toneColor: Record<string, string> = { green: '#1f9d55', orange: '#d97706', blue: '#2563eb', purple: '#7c3aed', red: '#dc2626', grey: '#6b7280', teal: '#0d9488' };

type Item = { label: string; run?: () => Promise<any>; href?: string; danger?: boolean; confirm?: boolean };

function itemsFor(r: QtRow, W: boolean, AP: boolean, onDeposit: (r: QtRow, k: 'INV' | 'CA' | 'BL') => void): Item[] {
  const s = r.status, out: Item[] = [];
  const bill = W && ['pending_approval', 'approved', 'partial'].includes(s);
  if (AP && s === 'pending_approval') out.push({ label: 'อนุมัติ', run: () => A.approveQuote(r.id) });
  if (W && s === 'approved') out.push({ label: 'ดำเนินการแล้ว', run: () => A.closeQuotation(r.id), confirm: true });
  if (bill && s !== 'partial') out.push({ label: 'สร้างใบวางบิล', run: () => A.billQuotation(r.id, 'BL') });
  if (bill) out.push({ label: s === 'partial' ? 'ออกใบแจ้งหนี้ที่เหลือ' : 'สร้างใบแจ้งหนี้', run: () => A.quoteToInvoice(r.id) });
  if (bill) out.push({ label: 'สร้างขายสด', run: () => A.billQuotation(r.id, 'CA') });
  if (bill) out.push({ label: s === 'partial' ? 'แบ่งจ่ายเพิ่ม' : 'แบ่งจ่าย', href: `/sales/${r.doc_no}/split` });
  if (W && ['pending_approval', 'approved'].includes(s)) for (const [k, l] of [['INV', 'มัดจำใบแจ้งหนี้'], ['BL', 'มัดจำใบวางบิล'], ['CA', 'มัดจำใบกำกับภาษี/ใบเสร็จ (เงินสด)']] as const)
    out.push({ label: l, run: async () => { onDeposit(r, k); return {}; } });
  if (W && s === 'deposit_paid') {
    out.push({ label: 'เปิดเป็นใบแจ้งหนี้ (หักมัดจำ)', run: () => A.createFinalInvoice(r.id, 'INV') });
    out.push({ label: 'เปิดเป็นใบวางบิล (หักมัดจำ)', run: () => A.createFinalInvoice(r.id, 'BL') });
    out.push({ label: 'เปิดเป็นใบกำกับภาษี/ใบเสร็จ (เงินสด) (หักมัดจำ)', run: () => A.createFinalInvoice(r.id, 'CA') });
  }
  if (AP && ['pending_approval', 'approved'].includes(s)) out.push({ label: 'ไม่อนุมัติ', run: () => A.rejectQuote(r.id), danger: true, confirm: true });
  if (AP && ['rejected', 'approved', 'partial', 'converted'].includes(s)) out.push({ label: 'รีเซ็ต', run: () => A.resetQuote(r.id) });
  return out;
}

function Menu({ trigger, items, onRun, align = 'left' }: { trigger: React.ReactNode; items: Item[]; onRun: (i: Item) => void; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false);
  const [armed, setArmed] = useState<string | null>(null);
  return (
    <span style={{ position: 'relative', display: 'inline-block' }}>
      <span onClick={() => { setOpen(!open); setArmed(null); }} style={{ cursor: 'pointer' }}>{trigger}</span>
      {open && <>
        <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 20 }} />
        <div className="panel" style={{ position: 'absolute', zIndex: 21, top: '100%', [align]: 0, minWidth: 190, padding: 4, boxShadow: '0 6px 20px rgba(0,0,0,.18)' }}>
          {items.length === 0 && <div className="sub" style={{ padding: 8 }}>ไม่มีรายการ</div>}
          {items.map(i => {
            const st: React.CSSProperties = { display: 'block', width: '100%', textAlign: 'left', padding: '7px 10px', background: 'none', border: 0, cursor: 'pointer', color: i.danger ? '#dc2626' : 'inherit', textDecoration: 'none', font: 'inherit' };
            if (i.href) return <Link key={i.label} href={i.href} style={st}>{i.label}</Link>;
            return <button key={i.label} style={st} onClick={() => {
              if (i.confirm && armed !== i.label) return setArmed(i.label);
              setOpen(false); onRun(i);
            }}>{armed === i.label ? `กดอีกครั้งเพื่อยืนยัน: ${i.label}` : i.label}</button>;
          })}
        </div>
      </>}
    </span>
  );
}

export function QtTable({ rows, canWrite, canApprove, canOwn, exportHref }: { rows: QtRow[]; canWrite: boolean; canApprove: boolean; canOwn: boolean; exportHref: string }) {
  const router = useRouter();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<string | null>(null);
  const [info, setInfo] = useState<QtRow | null>(null);
  const [dep, setDep] = useState<QtRow | null>(null);
  const [depKind, setDepKind] = useState<'INV' | 'CA' | 'BL'>('INV');
  const [depNet, setDepNet] = useState('');
  const [pending, start] = useTransition();
  const run = (i: Item) => start(async () => {
    const r = await i.run!(); if (r?.error) { setMsg(r.error); setTimeout(() => setMsg(null), 7000); } else { if (!i.label.startsWith('มัดจำใบ')) setDep(null); router.refresh(); }
  });
  const toggle = (id: string) => setSel(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const all = rows.length > 0 && rows.every(r => sel.has(r.id));
  const W = canWrite || canOwn;
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '8px 0', minHeight: 36, flexWrap: 'wrap' }}>
        {sel.size === 0 ? <span className="chip">แสดงทั้งหมด</span> : <>
          <strong>เลือก {sel.size} รายการ</strong>
          <button className="btn sm ghost" onClick={() => setSel(new Set())}>✕ ล้างที่เลือก</button>
          <a className="btn sm ghost" href={`${exportHref}&ids=${[...sel].join(',')}`}>⬇ Excel เฉพาะที่เลือก</a>
          <a className="btn sm ghost" href={`/sales/batch-pdf?download=1&ids=${[...sel].join(',')}`}>⬇ ดาวน์โหลด PDF</a>
          <a className="btn sm ghost" target="_blank" href={`/sales/batch-pdf?ids=${[...sel].join(',')}`}>🖨 พิมพ์เอกสาร</a>
          <a className="btn sm ghost" target="_blank" href={`/sales/envelope?ids=${[...sel].join(',')}`}>✉ พิมพ์จ่าหน้าซอง</a>
        </>}
        <a className="btn sm ghost" href={exportHref} title="ดาวน์โหลดตามเงื่อนไขที่กรองอยู่ (ทุกหน้า)">⬇ ดาวน์โหลด Excel</a>
      </div>
      <div className="panel" style={{ padding: 0, overflow: 'visible' }}>
        <div style={{ minHeight: 200 }}>
          <table className="qtcards"><thead><tr>
            <th style={{ width: 30 }}><input type="checkbox" checked={all} onChange={() => setSel(all ? new Set() : new Set(rows.map(r => r.id)))} aria-label="เลือกทั้งหมด" /></th>
            <th>วันที่</th><th>เลขที่เอกสาร</th><th>ชื่อลูกค้า / โปรเจ็ค</th><th className="num">ยอดรวมสุทธิ</th><th>สถานะ</th><th /></tr></thead>
            <tbody>{rows.map(r => {
              const [label, tone] = STATUS[r.status] ?? [r.status, 'grey'];
              const dim = r.status === 'rejected' || r.status === 'cancelled';
              const its = itemsFor(r, canWrite, canApprove, (x, k) => { setDep(x); setDepKind(k); setDepNet(''); });
              const more: Item[] = [
                ...((W) && r.status === 'pending_approval' ? [{ label: 'แก้ไข', href: `/sales/${r.doc_no}/edit` }] : []),
                { label: 'พิมพ์', href: `/sales/${r.doc_no}/pdf` }, { label: 'แชร์', href: `/sales/${r.doc_no}` },
                { label: 'ดาวน์โหลด PDF', href: `/sales/${r.doc_no}/pdf?download=1` }, { label: 'พิมพ์จ่าหน้าซอง', href: `/sales/envelope?ids=${r.doc_no}` },
                ...(W ? [{ label: 'สร้างซ้ำ', run: () => A.duplicateQuote(r.id) }] : []),
                ...(W && !['cancelled', 'converted', 'rejected'].includes(r.status) ? [{ label: 'ยกเลิก', run: () => A.cancelSalesDoc(r.id), danger: true, confirm: true }] : []),
              ];
              return (
                <tr key={r.id} style={{ opacity: dim ? .55 : 1 }}>
                  <td className="c-chk"><input type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)} aria-label={`เลือก ${r.doc_no}`} /></td>
                  <td className="c-date">{dth(r.date)}</td>
                  <td className="no c-no"><span style={{ color: toneColor[tone], marginRight: 4 }}>●</span><Link href={`/sales/${r.doc_no}`}>{r.doc_no}</Link>
                    <RelPop rel={r.rel} />
                  </td>
                  <td className="c-cust">{r.customer}{r.project ? <div className="sub">{r.project}</div> : null}</td>
                  <td className="num c-total">{fmt(r.total)}
                    {r.billing && <div className="sub">{r.billing.deposit ? 'รับมัดจำแล้ว' : 'เรียกเก็บแล้ว'} {fmt(r.billing.billed)} <button aria-label="ประวัติการเรียกเก็บ" onClick={() => setInfo(r)}
                      style={{ background: 'none', border: 0, cursor: 'pointer', color: '#db2777' }}>ⓘ</button></div>}</td>
                  <td className="c-st"><Menu trigger={<span className="pill" style={{ background: toneColor[tone], color: '#fff', padding: '3px 10px', borderRadius: 12 }}>{label} ▾</span>} items={its} onRun={run} /></td>
                  <td className="c-more"><Menu align="right" trigger={<span style={{ padding: '0 8px', fontWeight: 700 }}>⋯</span>} items={more} onRun={run} /></td>
                </tr>);
            })}</tbody></table>
        </div>
      </div>
      {pending && <div className="toast">กำลังดำเนินการ...</div>}
      {msg && <div className="toast" role="alert" onClick={() => setMsg(null)}>{msg}</div>}
      {dep && (() => {
        const net = Number(depNet) || 0, vat = Math.round(net * dep.rate) / 100, tot = net + vat;
        const bad = net <= 0 || net > dep.subtotal;
        return (
          <div onClick={() => setDep(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', zIndex: 50, display: 'grid', placeItems: 'center' }}>
            <div className="panel" onClick={e => e.stopPropagation()} style={{ maxWidth: 420, width: '94%' }}>
              <h3>{({ INV: 'มัดจำใบแจ้งหนี้', BL: 'มัดจำใบวางบิล', CA: 'มัดจำใบกำกับภาษี/ใบเสร็จ (เงินสด)' })[depKind]} — {dep.doc_no}</h3>
              <p className="sub">มูลค่าใบเสนอราคา {fmt(dep.total)} (ก่อน VAT {fmt(dep.subtotal)})</p>
              <label className="f">ยอดมัดจำ (ก่อน VAT)<input type="number" min="0" step="0.01" autoFocus value={depNet} onChange={e => setDepNet(e.target.value)} /></label>
              <p>VAT {dep.rate}% <b>{fmt(vat)}</b> · รวม <b>{fmt(tot)}</b> · ยอดคงเหลือ <b>{fmt(Math.max(dep.total - tot, 0))}</b></p>
              <p style={{ textAlign: 'right' }}><button className="btn sm ghost" onClick={() => setDep(null)}>ยกเลิก</button>{' '}
                <button className="btn sm" disabled={bad || pending} onClick={() => run({ label: 'มัดจำ', run: () => A.createDeposit(dep.id, net, depKind) })}>บันทึกเอกสาร</button></p>
              {depNet !== '' && bad && <p className="sub" style={{ color: '#dc2626' }}>ยอดมัดจำต้องมากกว่า 0 และไม่เกินมูลค่าใบเสนอราคา</p>}
            </div>
          </div>);
      })()}
      {info?.billing && (
        <div onClick={() => setInfo(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', zIndex: 50, display: 'grid', placeItems: 'center' }}>
          <div className="panel" onClick={e => e.stopPropagation()} style={{ maxWidth: 640, width: '94%', maxHeight: '86vh', overflow: 'auto' }}>
            <h3>{info.billing.deposit ? 'ประวัติการมัดจำ' : 'ประวัติการเรียกเก็บจากมูลค่าเอกสาร'} {info.doc_no}</h3>
            <p>มูลค่าที่ต้องชำระ <b>{fmt(info.billing.total)}</b> · {info.billing.deposit ? 'รับเงินมัดจำแล้ว' : 'เรียกเก็บแล้ว'} <b>{fmt(info.billing.billed)}</b> · ยังไม่ได้เรียกเก็บ <b>{fmt(info.billing.remaining)}</b> · สถานะ <b>{info.billing.percent}%</b></p>
            <div style={{ overflowX: 'auto' }}><table><thead><tr><th>ลำดับ</th><th>เลขที่อ้างอิง</th><th>วันที่เอกสาร</th><th className="num">ยอดรวมก่อนภาษี</th><th className="num">มูลค่าที่ต้องชำระ</th></tr></thead>
              <tbody>{info.billing.docs.map((d, i) => <tr key={d.doc_no}><td>{i + 1}</td><td><Link href={`/sales/${d.doc_no}`}>{d.doc_no}</Link></td><td>{dth(String(d.doc_date).slice(0, 10))}</td><td className="num">{fmt(d.subtotal)}</td><td className="num">{fmt(d.total)}</td></tr>)}
                {info.billing.closed > 0 && <tr><td>{info.billing.docs.length + 1}</td><td>ปิดยอดคงเหลือ</td><td>-</td><td className="num">-</td><td className="num">{fmt(info.billing.closed)}</td></tr>}</tbody></table></div>
            <p style={{ textAlign: 'right' }}><button className="btn sm" onClick={() => setInfo(null)}>ปิด</button></p>
          </div>
        </div>)}
    </>
  );
}
