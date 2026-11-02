'use client';
import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AssetFiles } from '@/components/AssetFiles';
import { createAsset, uploadAssetFile, updateAsset, setAssetStatus, disposeAsset, reopenAsset, deleteAsset } from '@/lib/actions';
import { ActionButton } from '@/components/ActionButton';

export interface Cat { id: string; name: string; depreciate: boolean; life_years: number | null }
export interface AssetVal {
  id?: string; code: string; name: string; description: string; ref_no: string; category_id: string; qty: string; unit: string; purchase_date: string; start_date: string;
  cost: string; depreciate: boolean; salvage: string; life_years: string; hasOpen: boolean; accum_open: string; calc_start: string;
  vendor: string; serial_no: string; warranty_end: string; location: string; user_name: string; note: string;
}
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** ฟอร์มสินทรัพย์ (เพิ่มยกมา / แก้ไข) · สินทรัพย์จากเอกสารค่าใช้จ่ายล็อกชื่อ จำนวน วันที่ซื้อ ราคา ผู้จำหน่าย เลขอ้างอิง */
export function AssetForm({ cats, today, init, locked = false, readOnly = false }: { cats: Cat[]; today: string; init?: AssetVal; locked?: boolean; readOnly?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [v, setV] = useState<AssetVal>(init ?? { code: '', name: '', description: '', ref_no: '', category_id: '', qty: '1', unit: '', purchase_date: today, start_date: today, cost: '',
    depreciate: true, salvage: '1.00', life_years: '', hasOpen: false, accum_open: '', calc_start: today, vendor: '', serial_no: '', warranty_end: '', location: '', user_name: '', note: '' });
  const [queue, setQueue] = useState<File[]>([]);
  const set = (p: Partial<AssetVal>) => setV(o => ({ ...o, ...p }));
  const pickCat = (id: string) => { const c = cats.find(x => x.id === id); set({ category_id: id, ...(c ? { depreciate: c.depreciate, life_years: c.life_years ? String(c.life_years) : v.life_years } : {}) }); };
  const calc = useMemo(() => {
    const cost = Number(v.cost) || 0, salv = Number(v.salvage) || 0, life = Number(v.life_years) || 0;
    const rate = life > 0 ? r2(100 / life) : 0, base = Math.max(cost - salv, 0);
    return { rate, base, annual: r2(base * rate / 100) };
  }, [v.cost, v.salvage, v.life_years]);
  const dis = readOnly || pending;
  const L = (t: string, c: React.ReactNode) => <label className="f">{t}{c}</label>;
  const save = (close: boolean) => start(async () => {
    setErr(null);
    const data = { ...v, accum_open: v.hasOpen ? v.accum_open : '0', calc_start: v.hasOpen ? v.calc_start : v.start_date };
    const r = init?.id ? await updateAsset(init.id, data) : await createAsset(data);
    if (r.error) return setErr(r.error);
    const id = init?.id ?? (r as any).id;
    if (!init?.id) for (const file of queue) { const f = new FormData(); f.set('id', id); f.set('file', file); const u = await uploadAssetFile(f); if (u.error) return setErr(`สร้างสินทรัพย์แล้ว แต่แนบ ${file.name} ไม่สำเร็จ: ${u.error}`); }
    router.push(close ? '/assets' : `/assets/${id}`); router.refresh();
  });
  return (
    <div className="wide" style={{ display: 'grid', gap: 12 }}>
      <section className="panel" style={{ padding: 16, display: 'grid', gap: 10 }}>
        <h3>ข้อมูลพื้นฐาน</h3>
        {locked && <p className="sub">สินทรัพย์นี้สร้างจากเอกสารค่าใช้จ่าย — ชื่อ จำนวน วันที่ซื้อ ราคา ผู้จำหน่าย และเลขที่อ้างอิง แก้ที่นี่ไม่ได้</p>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 10 }}>
          {L('รหัสสินทรัพย์', <input aria-label="รหัสสินทรัพย์" placeholder="เว้นว่าง = ให้ระบบสร้าง" value={v.code} disabled={dis} onChange={e => set({ code: e.target.value })} />)}
          {L('ชื่อสินทรัพย์ *', <input aria-label="ชื่อสินทรัพย์" value={v.name} disabled={dis || locked} onChange={e => set({ name: e.target.value })} />)}
          {L('หมวดหมู่ *', <select aria-label="หมวดหมู่" value={v.category_id} disabled={dis} onChange={e => pickCat(e.target.value)}><option value="">เลือกหมวดหมู่</option>{cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>)}
          {L('เลขที่เอกสารอ้างอิง', <input aria-label="เลขที่อ้างอิง" value={v.ref_no} disabled={dis || locked} onChange={e => set({ ref_no: e.target.value })} />)}
          {L('จำนวน', <input aria-label="จำนวน" inputMode="decimal" value={v.qty} disabled={dis || locked} onChange={e => set({ qty: e.target.value })} />)}
          {L('หน่วย', <input aria-label="หน่วย" value={v.unit} disabled={dis || locked} onChange={e => set({ unit: e.target.value })} />)}
          {L('วันที่ซื้อ *', <input type="date" aria-label="วันที่ซื้อ" value={v.purchase_date} disabled={dis || locked} onChange={e => set({ purchase_date: e.target.value, ...(init?.id ? {} : { start_date: e.target.value, calc_start: e.target.value }) })} />)}
        </div>
        {L('รายละเอียด', <textarea aria-label="รายละเอียด" rows={2} value={v.description} disabled={dis} onChange={e => set({ description: e.target.value })} />)}
      </section>
      <section className="panel" style={{ padding: 16, display: 'grid', gap: 10 }}>
        <h3>การคำนวณค่าเสื่อมราคา</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 10 }}>
          {L('วันที่เริ่มต้นใช้งาน *', <input type="date" aria-label="วันที่เริ่มต้นใช้งาน" value={v.start_date} disabled={dis} onChange={e => set({ start_date: e.target.value, ...(v.hasOpen ? {} : { calc_start: e.target.value }) })} />)}
          {L('ราคาซื้อ (ไม่รวม VAT) *', <input aria-label="ราคาซื้อ" inputMode="decimal" value={v.cost} disabled={dis || locked} onChange={e => set({ cost: e.target.value })} />)}
          {L('อายุการใช้งาน (ปี)', <input aria-label="อายุการใช้งาน" inputMode="decimal" value={v.life_years} disabled={dis || !v.depreciate} onChange={e => set({ life_years: e.target.value })} />)}
          {L('มูลค่าซาก', <input aria-label="มูลค่าซาก" inputMode="decimal" value={v.salvage} disabled={dis || !v.depreciate} onChange={e => set({ salvage: e.target.value })} />)}
        </div>
        <label><input type="checkbox" checked={v.depreciate} disabled={dis} onChange={e => set({ depreciate: e.target.checked })} /> คิดค่าเสื่อมสินทรัพย์นี้</label>
        {v.depreciate && <>
          <label><input type="checkbox" checked={v.hasOpen} disabled={dis} onChange={e => set({ hasOpen: e.target.checked, calc_start: e.target.checked ? v.calc_start : v.start_date })} /> มีค่าเสื่อมสะสมยกมา (ข้อมูลจากทะเบียนสินทรัพย์ล่าสุด)</label>
          {v.hasOpen && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 10 }}>
            {L('ค่าเสื่อมราคาสะสมยกมา', <input aria-label="ค่าเสื่อมสะสมยกมา" inputMode="decimal" value={v.accum_open} disabled={dis} onChange={e => set({ accum_open: e.target.value })} />)}
            {L('วันที่เริ่มคำนวณค่าเสื่อมราคา', <input type="date" aria-label="วันที่เริ่มคำนวณค่าเสื่อม" value={v.calc_start} disabled={dis} onChange={e => set({ calc_start: e.target.value })} />)}</div>}
          <table style={{ minWidth: 0, maxWidth: 460 }}><tbody>
            <tr><td>มูลค่าที่คิดค่าเสื่อม (ราคา − ซาก)</td><td className="num">{fmt(calc.base)}</td></tr>
            <tr><td>อัตราค่าเสื่อม/ปี (ปัดทศนิยม 2 ตำแหน่ง)</td><td className="num">{calc.rate.toFixed(2)}%</td></tr>
            <tr><td><b>ค่าเสื่อมราคา/ปี</b></td><td className="num"><b>{fmt(calc.annual)}</b></td></tr></tbody></table></>}
      </section>
      <section className="panel" style={{ padding: 16, display: 'grid', gap: 10 }}>
        <h3>ข้อมูลอื่น ๆ</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 10 }}>
          {L('ชื่อผู้จำหน่าย', <input aria-label="ผู้จำหน่าย" value={v.vendor} disabled={dis || locked} onChange={e => set({ vendor: e.target.value })} />)}
          {L('หมายเลขซีเรียล', <input aria-label="ซีเรียล" value={v.serial_no} disabled={dis} onChange={e => set({ serial_no: e.target.value })} />)}
          {L('วันหมดประกัน', <input type="date" aria-label="วันหมดประกัน" value={v.warranty_end} disabled={dis} onChange={e => set({ warranty_end: e.target.value })} />)}
          {L('ที่ตั้งสินทรัพย์', <input aria-label="ที่ตั้ง" value={v.location} disabled={dis} onChange={e => set({ location: e.target.value })} />)}
          {L('ผู้ใช้งาน', <input aria-label="ผู้ใช้งาน" value={v.user_name} disabled={dis} onChange={e => set({ user_name: e.target.value })} />)}
        </div>
        {L('โน้ต', <textarea aria-label="โน้ต" rows={2} value={v.note} disabled={dis} onChange={e => set({ note: e.target.value })} />)}
      </section>
      {!init?.id && !readOnly && <section className="panel" style={{ padding: 16 }}><h3 style={{ marginTop: 0 }}>แนบเอกสาร/รูปภาพ</h3><AssetFiles files={[]} canWrite queue={queue} setQueue={setQueue} /></section>}
      {err && <p className="sub" role="alert" style={{ color: 'var(--red)' }}>{err}</p>}
      {!readOnly && <div className="acts" style={{ justifyContent: 'flex-start', gap: 8 }}>
        <button type="button" className="btn" disabled={pending || !v.name.trim() || !v.category_id || v.cost === ''} onClick={() => save(false)}>{pending ? '...' : 'บันทึกเอกสาร'}</button>
        <button type="button" className="btn ghost" disabled={pending || !v.name.trim() || !v.category_id || v.cost === ''} onClick={() => save(true)}>บันทึกแล้วปิด</button>
        <button type="button" className="btn ghost" onClick={() => router.push('/assets')}>ปิดหน้าต่าง</button></div>}
    </div>
  );
}

/** ปุ่มพักการใช้งาน ⇄ กลับมาใช้งาน (ทันที ไม่มีหน้าต่างยืนยัน ตามต้นแบบ) */
export function AssetStatusBtn({ id, status }: { id: string; status: string }) {
  return <ActionButton variant="ghost" label={status === 'suspended' ? 'กลับมาใช้งาน' : 'พักการใช้งาน'} action={() => setAssetStatus(id, status === 'suspended' ? 'in_use' : 'suspended')} />;
}

/** ข้อมูลสินทรัพย์ที่เลิกใช้งาน: ขาย / บริจาค / ทำลาย พร้อมคำนวณกำไรขาดทุนให้ดูก่อนยืนยัน */
export function DisposePanel({ id, today, cost, annual, accumOpen, calcStart, startDate, depreciate, salvage }:
  { id: string; today: string; cost: number; annual: number; accumOpen: number; calcStart: string; startDate: string; depreciate: boolean; salvage: number }) {
  const router = useRouter();
  const [d, setD] = useState({ date: today, type: 'sold', price: '', note: '' });
  const [err, setErr] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);
  const [pending, start] = useTransition();
  const days = Math.max(0, Math.round((Date.parse(d.date + 'T00:00:00Z') - Date.parse(calcStart + 'T00:00:00Z')) / 86400000) + 1);
  const accum = depreciate && days > 0 ? r2(accumOpen + Math.min(Math.max(cost - salvage - accumOpen, 0), r2(annual * days / 365))) : depreciate ? 0 : 0;
  const book = r2(cost - accum), price = d.type === 'sold' ? Number(d.price) || 0 : 0;
  return (
    <section className="panel" style={{ padding: 16, display: 'grid', gap: 10 }}>
      <h3>เลิกใช้สินทรัพย์ (ขาย / บริจาค / ทำลาย)</h3>
      <p className="sub">เป็นการตัดรายการสินทรัพย์ออกจากทะเบียนและลงบัญชีตัดสินทรัพย์เท่านั้น — ต้องเปิดเอกสารขายและบันทึกภาษีที่เกี่ยวข้องเอง</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 10 }}>
        <label className="f">วันที่เลิกใช้<input type="date" aria-label="วันที่เลิกใช้" min={startDate} value={d.date} onChange={e => setD({ ...d, date: e.target.value })} /></label>
        <label className="f">ประเภท<select aria-label="ประเภทการเลิกใช้" value={d.type} onChange={e => setD({ ...d, type: e.target.value })}><option value="sold">ขาย</option><option value="donated">บริจาค</option><option value="destroyed">ทำลาย</option></select></label>
        {d.type === 'sold' && <label className="f">มูลค่าที่ขาย (ไม่รวม VAT)<input aria-label="มูลค่าที่ขาย" inputMode="decimal" value={d.price} onChange={e => setD({ ...d, price: e.target.value })} /></label>}
        <label className="f">โน้ต<input aria-label="โน้ตเลิกใช้" value={d.note} onChange={e => setD({ ...d, note: e.target.value })} /></label>
      </div>
      <table style={{ minWidth: 0, maxWidth: 460 }}><tbody>
        <tr><td>ราคาซื้อ</td><td className="num">{fmt(cost)}</td></tr>
        <tr><td>ค่าเสื่อมราคาสะสมถึงวันที่เลิกใช้</td><td className="num">{fmt(accum)}</td></tr>
        <tr><td>มูลค่าสินทรัพย์ที่เหลือ</td><td className="num">{fmt(book)}</td></tr>
        <tr><td><b>กำไร(ขาดทุน)</b></td><td className="num"><b>{fmt(price - book)}</b></td></tr></tbody></table>
      {d.type !== 'sold' && <p className="sub">บริจาค/ทำลาย: ตัดมูลค่าคงเหลือเป็นขาดทุนจากการจำหน่ายสินทรัพย์ <b>(รอเจ้าของระบบยืนยันวิธีลงบัญชี — ต้นแบบยังไม่ได้ทดสอบ)</b></p>}
      {d.type === 'sold' && <p className="sub">ราคาขายพักไว้ที่เดบิตบัญชี 49990 รายได้อื่น ตามที่ต้นแบบลงบัญชี <b>(รอเจ้าของระบบยืนยัน)</b></p>}
      {err && <p className="sub" role="alert" style={{ color: 'var(--red)' }}>{err}</p>}
      <div className="acts" style={{ justifyContent: 'flex-start' }}>
        <button className="btn" disabled={pending} onClick={() => !armed ? (setArmed(true), setTimeout(() => setArmed(false), 10000)) : start(async () => {
          setArmed(false); const r = await disposeAsset(id, { date: d.date, type: d.type, price, note: d.note }); if (r.error) setErr(r.error); else { setErr(null); router.refresh(); } })}>
          {pending ? '...' : armed ? 'กดอีกครั้งเพื่อยืนยัน' : 'บันทึกการเลิกใช้'}</button></div>
    </section>
  );
}
export const ReopenBtn = ({ id }: { id: string }) => <ActionButton variant="ghost" label="ย้อนสถานะเป็นใช้งานอยู่" confirmText="กลับรายการใบตัดสินทรัพย์ (-R) แล้วคืนสถานะ (ต้นแบบยังไม่ได้ทดสอบ)" action={() => reopenAsset(id)} />;
export const DeleteAssetBtn = ({ id }: { id: string }) => <ActionButton variant="danger" label="ลบสินทรัพย์" confirmText="ลบสินทรัพย์นี้ออกจากทะเบียน" after="/assets" action={() => deleteAsset(id)} />;
