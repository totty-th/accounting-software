'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createProductFull, updateProductFull } from '@/lib/actions';
import { KIND_LABEL } from '@/lib/stock-labels';

type U = { unit: string; factor: string; sale: string; buy: string; barcode: string };
// ฟอร์มสร้างสินค้า (ตาม FA): ประเภท · ข้อมูลสินค้า · ขาย/ซื้อ · หลายหน่วย · ยอดตั้งต้น
export type ProductInit = { kind: string; name: string; code: string; category: string; unit: string; barcode: string; sale: string; buy: string; block: boolean; units: U[] };
export function ProductForm({ today, categories, units, init, editId }: { today: string; categories: string[]; units: string[]; init?: ProductInit; editId?: string }) {
  const r = useRouter();
  const [kind, setKind] = useState(init?.kind ?? 'goods_stock');
  const [f, setF] = useState(init ? { name: init.name, code: init.code, category: init.category, unit: init.unit, barcode: init.barcode, sale: init.sale, buy: init.buy } : { name: '', code: '', category: '', unit: '', barcode: '', sale: '', buy: '' });
  const [block, setBlock] = useState(init?.block ?? false);
  const [multi, setMulti] = useState(!!init?.units.length);
  const [us, setUs] = useState<U[]>(init?.units.length ? init.units : [{ unit: '', factor: '', sale: '', buy: '', barcode: '' }]);
  const [open, setOpen] = useState(false);
  const [o, setO] = useState({ date: today, qty: '', cost: '' });
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (k: string, v: string) => setF(p => ({ ...p, [k]: v }));
  const stock = kind === 'goods_stock';
  const save = () => start(async () => {
    const body = { kind, name: f.name, code: f.code, category: f.category, unit: f.unit, barcode: f.barcode, sale: Number(f.sale) || 0, buy: Number(f.buy) || 0, block,
      units: multi ? us.filter(u => u.unit.trim()).map(u => ({ unit: u.unit, factor: Number(u.factor), sale: Number(u.sale) || 0, buy: Number(u.buy) || 0, barcode: u.barcode })) : [],
      open: stock && open && !editId ? { date: o.date, qty: Number(o.qty), cost: Number(o.cost) } : null };
    const res = editId ? await updateProductFull(editId, body) : await createProductFull(body);
    if (res.error) setErr(res.error); else r.push(editId ? `/products/${editId}` : '/products');
  });
  return (
    <>
      <div className="panel"><h3>ประเภทสินค้า</h3>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>{Object.entries(KIND_LABEL).map(([k, l]) =>
          <label key={k}><input type="radio" name="kind" checked={kind === k} onChange={() => setKind(k)} /> {l}</label>)}</div></div>
      <div className="panel"><h3>ข้อมูลสินค้า</h3>
        <div className="grid">
          <label className="f">ชื่อสินค้า *<input value={f.name} onChange={e => set('name', e.target.value)} /></label>
          <label className="f">รหัสสินค้า *<input value={f.code} onChange={e => set('code', e.target.value)} /></label>
          <label className="f">หมวดสินค้า<input list="cats" value={f.category} onChange={e => set('category', e.target.value)} placeholder="เลือกหรือพิมพ์เพื่อสร้างใหม่" /><datalist id="cats">{categories.map(c => <option key={c} value={c} />)}</datalist></label>
          <label className="f">หน่วยสินค้าหลัก *<input list="units" value={f.unit} onChange={e => set('unit', e.target.value)} placeholder="เช่น แผ่น" /><datalist id="units">{units.map(c => <option key={c} value={c} />)}</datalist></label>
          <label className="f">เลขบาร์โค้ด<input value={f.barcode} onChange={e => set('barcode', e.target.value)} /></label>
        </div></div>
      <div className="panel"><h3>ข้อมูลการขาย / การซื้อ</h3>
        <div className="grid">
          <label className="f">ราคาขาย (ไม่รวม VAT)<input type="number" min="0" step="0.01" value={f.sale} onChange={e => set('sale', e.target.value)} /></label>
          <label className="f">ราคาซื้อ (ไม่รวม VAT)<input type="number" min="0" step="0.01" value={f.buy} onChange={e => set('buy', e.target.value)} /></label>
        </div>
        {stock && <label><input type="checkbox" checked={block} onChange={e => setBlock(e.target.checked)} /> ห้ามขาย/โอน/ปรับลดเกินคงเหลือ (ไม่ให้สต็อกติดลบ)</label>}</div>
      {stock && <div className="panel"><label><b>เพิ่มหน่วยสินค้า</b> <input type="checkbox" checked={multi} onChange={e => setMulti(e.target.checked)} /></label>
        <p className="sub">สินค้าที่ขายมากกว่า 1 หน่วยนับ เช่น แผ่น / มัด · เก็บอัตราแปลงไว้แสดงผล (เช่น 50 แผ่น ≈ 5 มัด)</p>
        {multi && <>{us.map((u, i) => <div className="grid" key={i}>
          <label className="f">หน่วยอื่น<input value={u.unit} onChange={e => setUs(us.map((x, j) => j === i ? { ...x, unit: e.target.value } : x))} /></label>
          <label className="f">1 หน่วยนี้ = กี่ {f.unit || 'หน่วยหลัก'}<input type="number" min="0" step="0.0001" value={u.factor} onChange={e => setUs(us.map((x, j) => j === i ? { ...x, factor: e.target.value } : x))} /></label>
          <label className="f">ราคาขาย<input type="number" min="0" value={u.sale} onChange={e => setUs(us.map((x, j) => j === i ? { ...x, sale: e.target.value } : x))} /></label>
          <label className="f">ราคาซื้อ<input type="number" min="0" value={u.buy} onChange={e => setUs(us.map((x, j) => j === i ? { ...x, buy: e.target.value } : x))} /></label>
        </div>)}
          {us.length < 10 && <button type="button" className="btn sm ghost" onClick={() => setUs([...us, { unit: '', factor: '', sale: '', buy: '', barcode: '' }])}>+ เพิ่มหน่วยสินค้า ({us.length}/10)</button>}</>}</div>}
      {stock && !editId && <div className="panel"><label><b>ตั้งค่ายอดเริ่มต้น</b> <input type="checkbox" checked={open} onChange={e => setOpen(e.target.checked)} /></label>
        {open && <div className="grid">
          <label className="f">วันที่ตั้งต้นสินค้า<input type="date" value={o.date} onChange={e => setO({ ...o, date: e.target.value })} /></label>
          <label className="f">จำนวนยอดตั้งต้น ({f.unit || 'หน่วยหลัก'})<input type="number" min="0" step="0.0001" value={o.qty} onChange={e => setO({ ...o, qty: e.target.value })} /></label>
          <label className="f">ต้นทุนต่อหน่วย<input type="number" min="0" step="0.01" value={o.cost} onChange={e => setO({ ...o, cost: e.target.value })} /></label>
        </div>}</div>}
      {err && <div className="notice" role="alert" style={{ borderLeftColor: 'var(--red)' }}>{err}</div>}
      <button className="btn" disabled={pending} onClick={save}>{pending ? 'กำลังบันทึก...' : 'บันทึก'}</button>{' '}
      <button className="btn ghost" onClick={() => r.back()}>ยกเลิก</button>
    </>
  );
}
