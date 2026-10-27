'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createTransfer } from '@/lib/actions';

type P = { id: string; code: string; name: string; unit: string; buy: number; block: boolean; byWh: Record<string, number> };
// ใบโอนสินค้า (ตาม FA): คลังต้นทาง/ปลายทาง + รายการ · เตือนเมื่อโอนเกินคงเหลือ (กันเมื่อสินค้าห้ามติดลบ ตอนรับสินค้า)
export function TransferForm({ today, whs, products }: { today: string; whs: { id: string; name: string }[]; products: P[] }) {
  const r = useRouter();
  const [date, setDate] = useState(today);
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [rows, setRows] = useState<{ pid: string; qty: string }[]>([{ pid: '', qty: '1' }]);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const pm = new Map(products.map(p => [p.id, p]));
  const total = rows.reduce((s, x) => s + (pm.get(x.pid) ? Number(x.qty) || 0 : 0), 0);
  const warn = rows.map(x => { const p = pm.get(x.pid); return p && from && Number(x.qty) > (p.byWh[from] ?? 0) ? p : null; });
  const save = () => start(async () => {
    const res = await createTransfer({ date, from, to, lines: rows.filter(x => x.pid).map(x => ({ product_id: x.pid, qty: Number(x.qty) })) });
    if (res.error) setErr(res.error); else r.push('/stock/transfers');
  });
  return (
    <>
      <div className="panel"><div className="grid">
        <label className="f">วันที่<input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
        <label className="f">คลังต้นทาง<select value={from} onChange={e => setFrom(e.target.value)}><option value="">กรุณาระบุคลังต้นทาง</option>{whs.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
        <label className="f">คลังปลายทาง<select value={to} onChange={e => setTo(e.target.value)}><option value="">กรุณาระบุคลังปลายทาง</option>{whs.filter(w => w.id !== from).map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
      </div></div>
      <div className="panel" style={{ padding: 0, overflowX: 'auto' }}>
        <table><thead><tr><th>ลำดับ</th><th>ชื่อสินค้า / รายละเอียด</th><th className="num">คงเหลือต้นทาง</th><th className="num">จำนวน</th><th>หน่วย</th><th className="num">ราคาต้นทุนต่อหน่วย</th><th className="num">ราคารวม</th><th></th></tr></thead>
          <tbody>{rows.map((x, i) => { const p = pm.get(x.pid); const q = Number(x.qty) || 0; return (
            <tr key={i}><td>{i + 1}</td>
              <td><select value={x.pid} onChange={e => setRows(rows.map((y, j) => j === i ? { ...y, pid: e.target.value } : y))}><option value="">เลือกสินค้า</option>{products.map(o => <option key={o.id} value={o.id}>{o.code} {o.name}</option>)}</select>
                {warn[i] && <div className="sub" style={{ color: 'var(--red)' }}>โอนเกินคงเหลือต้นทาง{warn[i]!.block ? ' — สินค้านี้ห้ามติดลบ จะรับสินค้าไม่ได้' : ' (สต็อกจะติดลบ)'}</div>}</td>
              <td className="num">{p && from ? (p.byWh[from] ?? 0).toLocaleString('th-TH') : '-'}</td>
              <td className="num"><input type="number" min="0" step="0.0001" style={{ width: 90 }} value={x.qty} onChange={e => setRows(rows.map((y, j) => j === i ? { ...y, qty: e.target.value } : y))} /></td>
              <td>{p?.unit ?? ''}</td><td className="num">{p ? p.buy.toLocaleString('th-TH', { minimumFractionDigits: 2 }) : ''}</td>
              <td className="num">{p ? (q * p.buy).toLocaleString('th-TH', { minimumFractionDigits: 2 }) : ''}</td>
              <td>{rows.length > 1 && <button type="button" className="btn sm ghost" onClick={() => setRows(rows.filter((_, j) => j !== i))}>ลบ</button>}</td></tr>); })}</tbody></table>
        <div style={{ padding: 10 }}><button type="button" className="btn sm ghost" onClick={() => setRows([...rows, { pid: '', qty: '1' }])}>+ เพิ่มแถวรายการ</button> <span className="sub">จำนวนสินค้ารวม {total.toLocaleString('th-TH')} · ราคาต้นทุนใช้ "ราคาซื้อ" ของสินค้า (ตามต้นแบบ) · การโอนไม่ลงบัญชี</span></div>
      </div>
      {err && <div className="notice" role="alert" style={{ borderLeftColor: 'var(--red)' }}>{err}</div>}
      <button className="btn" disabled={pending || !from || !to} onClick={save}>{pending ? 'กำลังบันทึก...' : 'บันทึกเอกสาร'}</button>{' '}
      <button className="btn ghost" onClick={() => r.push('/stock/transfers')}>ปิดหน้าต่าง</button>
    </>
  );
}
