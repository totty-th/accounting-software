'use client';
import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ADJUST_REASONS } from '@/lib/adjust-reasons';

type Result = { error?: string; ok?: true };
type Src = { description: string; item_kind: string; qty: number; unit_price: number; product_id: string | null; is_stock: boolean };
const money = (n: number) => n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const r2 = (x: number) => Math.round(x * 100) / 100;

// ฟอร์มออกใบเพิ่มหนี้/ใบลดหนี้ จากใบแจ้งหนี้: รายการในใบ = ส่วนที่เพิ่ม/ลด (ไม่ใช่ยอดใหม่)
export function AdjustForm({ type, refId, contactId, refNo, refTotal, refSubtotal, mode, rate, lines, today, action }: {
  type: 'CN' | 'DN'; refId: string; contactId: string; refNo: string; refTotal: number; refSubtotal: number; mode: string; rate: number;
  lines: Src[]; today: string; action: (p: any) => Promise<Result>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [date, setDate] = useState(today);
  const [rows, setRows] = useState(lines.map(l => ({ on: false, qty: String(l.qty), price: String(l.unit_price), stock: type === 'CN' ? 'return' : 'adjust' })));
  const hasGoods = lines.some(l => l.item_kind === 'goods');
  const [group, setGroup] = useState<'goods' | 'service'>(hasGoods ? 'goods' : 'service');
  const opts = ADJUST_REASONS[type][group];
  const [reason, setReason] = useState('');
  const [other, setOther] = useState('');
  const set = (i: number, p: Partial<(typeof rows)[number]>) => setRows(rs => rs.map((r, k) => (k === i ? { ...r, ...p } : r)));
  const pickGroup = (g: 'goods' | 'service') => { setGroup(g); setReason(''); };

  const t = useMemo(() => {
    const gross = lines.reduce((s, _, i) => s + (rows[i].on ? r2((+rows[i].qty || 0) * (+rows[i].price || 0)) : 0), 0);
    const net = mode === 'inclusive' ? r2(gross * 100 / (100 + rate)) : gross;
    const total = mode === 'inclusive' ? gross : r2(gross + r2(gross * rate / 100));
    const diffNet = net, diffTotal = total;
    return { net: diffNet, vat: r2(diffTotal - diffNet), total: diffTotal,
      correctNet: type === 'DN' ? r2(refSubtotal + diffNet) : r2(refSubtotal - diffNet) };
  }, [rows, lines, mode, rate, type, refSubtotal]);

  const isOther = opts.find(o => o.label === reason)?.other;
  const submit = () => start(async () => {
    setErr(null);
    const ls = lines.flatMap((l, i) => rows[i].on && +rows[i].qty > 0
      ? [{ description: l.description, kind: l.item_kind, qty: +rows[i].qty, unit_price: +rows[i].price || 0,
          product_id: l.product_id, stock_action: l.is_stock ? rows[i].stock : null }] : []);
    if (!ls.length) return setErr('ติ๊กเลือกรายการอย่างน้อย 1 บรรทัด');
    if (!reason) return setErr('กรุณาระบุสาเหตุในการออกเอกสาร');
    const text = isOther ? `${reason}: ${other.trim()}` : reason;
    if (isOther && !other.trim()) return setErr('ระบุสาเหตุเพิ่มเติม');
    const r = await action({ type, date, contact: contactId, mode, lines: ls, reason: text, ref: refId });
    if (r.error) return setErr(r.error);
    router.push('/sales?type=' + type);
  });

  return (
    <div className="panel">
      <h2 style={{ marginTop: 0 }}>{type === 'CN' ? 'ใบลดหนี้' : 'ใบเพิ่มหนี้'} จาก {refNo}</h2>
      <p className="sub">รายการที่เลือกคือ "ส่วนที่{type === 'CN' ? 'ลด' : 'เพิ่ม'}" ไม่ใช่ยอดใหม่ · ใบแจ้งหนี้เดิมไม่เปลี่ยนยอด ระบบหักกลบให้ตอนออกใบเสร็จรวม</p>
      <div className="grid">
        <label className="f">วันที่เอกสาร<input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
        <label className="f">ประเภทรายการ
          <select value={group} onChange={e => pickGroup(e.target.value as any)}><option value="goods">สินค้า</option><option value="service">บริการ</option></select>
        </label>
        <label className="f">สาเหตุ
          <select value={reason} onChange={e => setReason(e.target.value)}><option value="">-- กรุณาระบุเหตุผลในการออกเอกสาร --</option>{opts.map(o => <option key={o.label}>{o.label}</option>)}</select>
        </label>
        {isOther && <label className="f">ระบุสาเหตุ<input value={other} onChange={e => setOther(e.target.value)} /></label>}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="lines" style={{ minWidth: 780 }}>
          <thead><tr><th style={{ width: 40 }} /><th>รายการในใบแจ้งหนี้</th><th className="num" style={{ width: 100 }}>จำนวน</th><th className="num" style={{ width: 130 }}>ราคาต่อหน่วย</th><th style={{ width: 150 }}>สต็อก</th><th className="num" style={{ width: 120 }}>รวม</th></tr></thead>
          <tbody>{lines.map((l, i) => (
            <tr key={i}>
              <td><input type="checkbox" checked={rows[i].on} onChange={e => set(i, { on: e.target.checked })} aria-label={`เลือก ${l.description}`} /></td>
              <td>{l.description}</td>
              <td><input className="num" inputMode="decimal" value={rows[i].qty} onChange={e => set(i, { qty: e.target.value })} disabled={!rows[i].on} /></td>
              <td><input className="num" inputMode="decimal" value={rows[i].price} onChange={e => set(i, { price: e.target.value })} disabled={!rows[i].on} /></td>
              <td>{l.is_stock ? (
                <select value={rows[i].stock} onChange={e => set(i, { stock: e.target.value })} disabled={!rows[i].on} aria-label="ตัวเลือกสต็อก">
                  {type === 'CN' ? <><option value="return">คืนสินค้า</option><option value="no_return">ไม่คืน</option></>
                                 : <><option value="adjust">ปรับราคา</option><option value="cut">ตัดสต็อก</option></>}
                </select>) : <span className="sub">-</span>}</td>
              <td className="num">{rows[i].on ? money((+rows[i].qty || 0) * (+rows[i].price || 0)) : '-'}</td>
            </tr>))}</tbody>
        </table>
      </div>
      <div className="totals">
        <div><span>มูลค่าก่อนภาษีตามเอกสารเดิม</span><span>{money(refSubtotal)}</span></div>
        <div><span>มูลค่าที่ถูกต้อง</span><span>{money(t.correctNet)}</span></div>
        <div><span>ผลต่าง (ก่อนภาษี)</span><span>{money(t.net)}</span></div>
        <div><span>VAT {rate}%</span><span>{money(t.vat)}</span></div>
        <div className="t"><span>ยอด{type === 'CN' ? 'ลดหนี้' : 'เพิ่มหนี้'}รวม</span><span>{money(t.total)}</span></div>
        {type === 'CN' && <div><span>ยอดใบแจ้งหนี้เดิม</span><span>{money(refTotal)}</span></div>}
      </div>
      {err && <div className="notice" role="alert" style={{ borderLeftColor: 'var(--red)', marginTop: 14 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button className="btn" disabled={pending} onClick={submit}>{pending ? 'กำลังบันทึก...' : 'บันทึก'}</button>
        <button className="btn ghost" onClick={() => router.back()}>ยกเลิก</button>
      </div>
    </div>
  );
}
