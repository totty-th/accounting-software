'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { billQuotation } from '@/lib/actions';

const money = (x: unknown) => Number(x).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function SplitForm({ id, docNo, summary }: { id: string; docNo: string; summary: any }) {
  const r = useRouter();
  const [kind, setKind] = useState<'INV' | 'CA'>('INV');
  const [mode, setMode] = useState<'percent' | 'amount' | 'qty'>('percent');
  const [value, setValue] = useState('');
  const [qtys, setQtys] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function go() {
    setBusy(true); setMsg(null);
    const q: Record<string, number> = {};
    if (mode === 'qty') for (const [k, v] of Object.entries(qtys)) if (Number(v) > 0) q[k] = Number(v);
    const res = await billQuotation(id, kind, mode, mode === 'qty' ? null : Number(value), mode === 'qty' ? q : null);
    setBusy(false);
    if (res.ok) { setMsg({ ok: true, t: 'สร้างเอกสารแล้ว' }); r.push(`/sales/${docNo}`); r.refresh(); }
    else setMsg({ ok: false, t: res.error ?? 'ไม่สำเร็จ' });
  }

  return (
    <div className="panel">
      <ul className="rel">
        <li>มูลค่าใบเสนอราคา: <b>{money(summary.total)}</b></li>
        <li>เรียกเก็บแล้ว: <b>{money(summary.billed)}</b> ({Number(summary.percent)}%)</li>
        <li>คงเหลือ: <b>{money(summary.remaining)}</b></li>
      </ul>
      <div className="grid" style={{ marginTop: 14 }}>
        <label>เอกสารที่ออก
          <select value={kind} onChange={e => setKind(e.target.value as any)}>
            <option value="INV">ใบแจ้งหนี้</option><option value="CA">ขายสด (ใบกำกับภาษี/ใบเสร็จ)</option>
          </select></label>
        <label>วิธีแบ่ง
          <select value={mode} onChange={e => setMode(e.target.value as any)}>
            <option value="percent">เปอร์เซ็นต์</option><option value="amount">จำนวนเงิน (ประมาณ)</option><option value="qty">ตามจำนวนสินค้า</option>
          </select></label>
        {mode !== 'qty' && <label>{mode === 'percent' ? 'เปอร์เซ็นต์ (%)' : 'จำนวนเงินรวม VAT (บาท)'}
          <input type="number" min="0" step="0.01" value={value} onChange={e => setValue(e.target.value)} /></label>}
      </div>
      {mode === 'amount' && <p className="sub">คิดสัดส่วนจากยอดรวม อาจคลาดเคลื่อนไม่กี่สตางค์</p>}
      {mode === 'qty' && (
        <div style={{ overflowX: 'auto' }}>
          <table><thead><tr><th>รายการ</th><th className="num">จำนวนทั้งหมด</th><th className="num">เรียกเก็บแล้ว</th><th className="num">คงเหลือ</th><th className="num">เรียกเก็บครั้งนี้</th></tr></thead>
            <tbody>{summary.lines.map((l: any) => (
              <tr key={l.line_no}><td>{l.description}{l.unit ? ` (${l.unit})` : ''}</td>
                <td className="num">{Number(l.qty)}</td><td className="num">{Number(l.billed_qty)}</td><td className="num">{Number(l.remaining_qty)}</td>
                <td className="num"><input type="number" min="0" step="any" max={Number(l.remaining_qty)} style={{ width: 90 }} disabled={Number(l.remaining_qty) <= 0}
                  value={qtys[l.line_no] ?? ''} onChange={e => setQtys({ ...qtys, [l.line_no]: e.target.value })} /></td></tr>))}</tbody></table>
        </div>)}
      <div className="acts" style={{ justifyContent: 'flex-start', marginTop: 14 }}>
        <button className="btn" disabled={busy || Number(summary.remaining) <= 0} onClick={go}>{busy ? 'กำลังสร้าง…' : 'สร้างเอกสาร'}</button>
        <a className="btn ghost" href={`/sales/${docNo}`}>กลับ</a>
      </div>
      {msg && <p className={msg.ok ? 'sub' : 'err'} role="alert">{msg.t}</p>}
    </div>
  );
}
