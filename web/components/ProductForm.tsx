'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createProductFull, updateProductFull } from '@/lib/actions';
import { KIND_LABEL } from '@/lib/stock-labels';

type U = { unit: string; factor: string; sale: string; buy: string; barcode: string };
// ฟอร์มสร้างสินค้า (ตาม FA): ประเภท · ข้อมูลสินค้า · ขาย/ซื้อ · หลายหน่วย · ยอดตั้งต้น
export type ProductInit = { kind: string; name: string; code: string; category: string; unit: string; barcode: string; sale: string; buy: string; block: boolean; units: U[];
  description: string; saleVat: string; buyVat: string; goodsType: string; lowMode: 'default' | 'custom'; low: Record<string, string> };
const VATS: [string, string][] = [['exclusive', 'ราคายังไม่รวม VAT'], ['inclusive', 'ราคารวม VAT แล้ว'], ['zero', 'VAT 0%'], ['exempt', 'สินค้าได้รับยกเว้นภาษี (N/A)']];
type Wh = { id: string; name: string; is_main: boolean; low_stock_min: number | null };
export function ProductForm({ today, categories, units, init, editId, whs = [] }: { today: string; categories: string[]; units: string[]; init?: ProductInit; editId?: string; whs?: Wh[] }) {
  const r = useRouter();
  const [kind, setKind] = useState(init?.kind ?? 'goods_stock');
  const [f, setF] = useState(init ? { name: init.name, code: init.code, category: init.category, unit: init.unit, barcode: init.barcode, sale: init.sale, buy: init.buy } : { name: '', code: '', category: '', unit: '', barcode: '', sale: '', buy: '' });
  const [desc, setDesc] = useState(init?.description ?? '');
  const [vat, setVat] = useState({ sale: init?.saleVat ?? 'exclusive', buy: init?.buyVat ?? 'exclusive' });
  const [gtype, setGtype] = useState(init?.goodsType ?? 'for_sale');
  const [lowOn, setLowOn] = useState(true);
  const [lowMode, setLowMode] = useState<'default' | 'custom'>(init?.lowMode ?? 'default');
  const [low, setLow] = useState<Record<string, string>>(init?.low ?? {});
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
    const body = { kind, name: f.name, code: f.code, category: f.category, unit: f.unit, barcode: f.barcode, sale: Number(f.sale) || 0, buy: Number(f.buy) || 0, block, description: desc, saleVat: vat.sale, buyVat: vat.buy, goodsType: gtype,
      lowMode: stock && lowOn ? lowMode : 'default', lowItems: Object.entries(low).filter(([, x]) => x !== '').map(([warehouse_id, x]) => ({ warehouse_id, min_qty: Number(x) })),
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
          {kind === 'goods_nostock' && <label className="f">ประเภท<select value={gtype} onChange={e => setGtype(e.target.value)}><option value="for_sale">สินค้าเพื่อขาย</option><option value="other">อื่น ๆ</option></select></label>}
        </div></div>
      <div className="panel"><h3>ข้อมูลการขาย / การซื้อ</h3>
        <div className="grid">
          <label className="f">ราคาขาย<input type="number" min="0" step="0.01" value={f.sale} onChange={e => set('sale', e.target.value)} /></label>
          <label className="f">ภาษีมูลค่าเพิ่ม (ขาย)<select value={vat.sale} onChange={e => setVat({ ...vat, sale: e.target.value })}>{VATS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          {kind !== 'service' && <><label className="f">ราคาซื้อ<input type="number" min="0" step="0.01" value={f.buy} onChange={e => set('buy', e.target.value)} /></label>
          <label className="f">ภาษีมูลค่าเพิ่ม (ซื้อ)<select value={vat.buy} onChange={e => setVat({ ...vat, buy: e.target.value })}>{VATS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label></>}
        </div>
        <label className="f">รายละเอียดสินค้า<textarea rows={3} value={desc} onChange={e => setDesc(e.target.value)} placeholder="แสดงในเอกสารขายอัตโนมัติเมื่อเลือกสินค้านี้" /></label>
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
      {stock && <div className="panel"><label><b>แสดงรายการสินค้าใกล้หมด</b> <input type="checkbox" checked={lowOn} onChange={e => setLowOn(e.target.checked)} /></label>
        <p className="sub">เมื่อสินค้าในสต็อกต่ำกว่าหรือเท่ากับจำนวนที่กำหนด จะขึ้นในเมนู "สินค้าใกล้หมด"</p>
        {lowOn && <><label><input type="radio" checked={lowMode === 'default'} onChange={() => setLowMode('default')} /> ตามค่าเริ่มต้น (ค่าขั้นต่ำที่ตั้งไว้ที่แต่ละคลัง)</label>
          {lowMode === 'default' && <ul className="rel">{whs.map(w => <li key={w.id}>{w.name}: {w.low_stock_min == null ? 'ไม่กำหนด' : w.low_stock_min}</li>)}</ul>}
          <label><input type="radio" checked={lowMode === 'custom'} onChange={() => setLowMode('custom')} /> กำหนดเอง</label>
          {lowMode === 'custom' && <div className="grid">{whs.map(w => <label className="f" key={w.id}>{w.name}{w.is_main ? ' (คลังหลัก)' : ''}<input type="number" min="0" step="0.0001" placeholder="ไม่กำหนด" value={low[w.id] ?? ''} onChange={e => setLow({ ...low, [w.id]: e.target.value })} /></label>)}</div>}</>}</div>}
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
