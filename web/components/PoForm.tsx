'use client';
import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { savePurchaseOrder, saveGoodsReceiptFull, quickCreateVendor, quickCreateProduct } from '@/lib/actions';

export interface Vendor { id: string; label: string; address: string; postal: string; tax_id: string; branch: string; credit_days: number }
export interface Prod { id: string; code: string; name: string; unit: string; price: number; onhand: number }
interface Wh { id: string; label: string }
interface Line { product_id: string; description: string; unit: string; qty: string; unit_price: string; dtype: 'percent' | 'amount'; dval: string; vat: string; wht: string }
const blank = (): Line => ({ product_id: '', description: '', unit: '', qty: '1', unit_price: '', dtype: 'percent', dval: '', vat: '7', wht: '0' });
const WHT = ['0', '0.5', '0.75', '1', '1.5', '2', '3', '5', '10', '15'];
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const addDays = (d: string, n: number) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

/** ใบสั่งซื้อ: ฟอร์มเต็มตามแบบ FlowAccount (REA 24-10-2026) — สร้างและแก้ไข */
export function PoForm({ kind = 'PO', id, vendors: v0, products: p0, warehouses, today, purchaser, init, canCreateVendor, canCreateProduct }: {
  kind?: 'PO' | 'RI'; id: string | null; vendors: Vendor[]; products: Prod[]; warehouses: Wh[]; today: string; purchaser: string;
  init?: { header: Record<string, any>; lines: Line[] }; canCreateVendor: boolean; canCreateProduct: boolean;
}) {
  const router = useRouter();
  const back = kind === 'RI' ? '/purchases' : '/purchases/orders';
  const [vendors, setVendors] = useState(v0); const [products, setProducts] = useState(p0);
  const h0 = init?.header ?? {};
  const [h, setH] = useState({ date: today, contact: '', credit_days: '0', due_date: today, purchaser, project: '', ref_no: '', description: '',
    price_mode: 'exclusive', warehouse_id: '', show_signature: true, note: '', internal_note: '', ...h0 });
  const [lines, setLines] = useState<Line[]>(init?.lines?.length ? init.lines : [blank(), blank(), blank()]);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [nv, setNv] = useState<{ name: string; tax_id: string; address: string } | null>(null);
  const [np, setNp] = useState<{ row: number; code: string; name: string; unit: string; buy: string } | null>(null);
  const set = (p: Partial<typeof h>) => setH(o => ({ ...o, ...p }));
  const setL = (i: number, p: Partial<Line>) => setLines(ls => ls.map((l, j) => (j === i ? { ...l, ...p } : l)));
  const vendor = vendors.find(v => v.id === h.contact);
  const pickVendor = (cid: string) => { const v = vendors.find(x => x.id === cid);
    const cd = v ? v.credit_days : 0; set({ contact: cid, credit_days: String(cd), due_date: addDays(h.date, cd) }); };
  const pickProduct = (i: number, pid: string) => { const p = products.find(x => x.id === pid); setL(i, { product_id: pid, unit: p?.unit ?? '', unit_price: p ? String(p.price) : '' }); };

  const calc = useMemo(() => {
    let net = 0, vat = 0, disc = 0, ex = 0, wht = 0;
    const per = lines.map(l => {
      if (!l.product_id) return { total: 0 };
      const gross = r2((Number(l.qty) || 0) * (Number(l.unit_price) || 0));
      const d = l.dtype === 'amount' ? Number(l.dval) || 0 : r2(gross * (Number(l.dval) || 0) / 100);
      const after = gross - d; const exempt = l.vat === 'exempt'; const vr = exempt ? 0 : Number(l.vat);
      let n: number, v: number;
      if (exempt || vr === 0) { n = after; v = 0; } else if (h.price_mode === 'exclusive') { n = after; v = r2(n * vr / 100); } else { n = r2(after * 100 / (100 + vr)); v = r2(after - n); }
      net += n; vat += v; disc += d; wht += r2(n * (Number(l.wht) || 0) / 100); if (exempt) ex += n;
      return { total: h.price_mode === 'exclusive' ? n : after };
    });
    return { per, net, vat, disc, ex, wht, total: r2(net + vat) };
  }, [lines, h.price_mode]);

  const ok = h.contact && lines.some(l => l.product_id) && lines.filter(l => l.product_id).every(l => Number(l.qty) > 0 && l.unit_price !== '');
  const submit = () => start(async () => {
    setErr(null);
    const save = kind === 'RI' ? (_: string | null, a: any, b: any[]) => saveGoodsReceiptFull(a, b) : savePurchaseOrder;
    const r = await save(id, { ...h, credit_days: Number(h.credit_days) || 0 },
      lines.filter(l => l.product_id).map(l => ({ product_id: l.product_id, description: l.description, unit: l.unit, qty: Number(l.qty), unit_price: Number(l.unit_price),
        discount_type: l.dtype, discount_value: Number(l.dval) || 0, vat: l.vat, wht_rate: Number(l.wht) || 0 })));
    if (r.error) return setErr(r.error);
    router.push(back); router.refresh();
  });
  const makeVendor = () => start(async () => {
    if (!nv?.name.trim()) return setErr('ต้องระบุชื่อผู้จำหน่าย');
    const r = await quickCreateVendor(nv); if (r.error) return setErr(r.error);
    const c = r.vendor; setVendors(vs => [...vs, { id: c.id, label: c.business_name, address: c.address ?? '', postal: c.postal_code ?? '', tax_id: c.tax_id ?? '', branch: 'สำนักงานใหญ่', credit_days: c.credit_days ?? 0 }]);
    pickVendor(c.id); setNv(null); setErr(null);
  });
  const makeProduct = () => start(async () => {
    if (!np?.name.trim() || !np.code.trim()) return setErr('ต้องระบุรหัสและชื่อสินค้า');
    const r = await quickCreateProduct({ code: np.code, name: np.name, unit: np.unit, buy: Number(np.buy) || 0 }); if (r.error) return setErr(r.error);
    const p = r.product; setProducts(ps => [...ps, { id: p.id, code: p.code, name: p.name, unit: p.base_unit, price: Number(p.purchase_price), onhand: 0 }]);
    setLines(ls => ls.map((l, j) => (j === np.row ? { ...l, product_id: p.id, unit: p.base_unit, unit_price: String(p.purchase_price) } : l))); setNp(null); setErr(null);
  });
  const lbl = (t: string, c: React.ReactNode) => <label className="f">{t}{c}</label>;

  return (
    <div className="wide" style={{ display: 'grid', gap: 12 }}>
      <section className="panel" style={{ padding: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.4fr) minmax(0,1fr)', gap: 24 }}>
          <div style={{ display: 'grid', gap: 8, alignContent: 'start' }}>
            {lbl('ชื่อผู้จำหน่าย', <select aria-label="ผู้จำหน่าย" value={h.contact} onChange={e => pickVendor(e.target.value)}>
              <option value="">เลือกผู้จำหน่าย</option>{vendors.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}</select>)}
            {canCreateVendor && !nv && <button type="button" className="btn sm ghost" onClick={() => setNv({ name: '', tax_id: '', address: '' })}>+ เพิ่มรายชื่อผู้ติดต่อ</button>}
            {nv && <div className="panel" style={{ padding: 8, display: 'grid', gap: 6 }}>
              <input aria-label="ชื่อผู้จำหน่ายใหม่" placeholder="ชื่อธุรกิจ" value={nv.name} onChange={e => setNv({ ...nv, name: e.target.value })} />
              <input aria-label="เลขผู้เสียภาษี" placeholder="เลขผู้เสียภาษี 10/13 หลัก" value={nv.tax_id} onChange={e => setNv({ ...nv, tax_id: e.target.value })} />
              <textarea aria-label="ที่อยู่ใหม่" placeholder="ที่อยู่" rows={2} value={nv.address} onChange={e => setNv({ ...nv, address: e.target.value })} />
              <div className="acts" style={{ justifyContent: 'flex-start' }}><button type="button" className="btn sm" disabled={pending} onClick={makeVendor}>บันทึกผู้จำหน่าย</button>
                <button type="button" className="btn sm ghost" onClick={() => setNv(null)}>ยกเลิก</button></div></div>}
            {vendor && <div className="sub" style={{ whiteSpace: 'pre-line' }}>
              <b>ที่อยู่</b> {vendor.address || '-'}{vendor.postal ? ` ${vendor.postal}` : ''}{'\n'}เลขผู้เสียภาษี {vendor.tax_id || '-'} · {vendor.branch}</div>}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, alignContent: 'start' }}>
            {lbl('วันที่', <input type="date" value={h.date} onChange={e => set({ date: e.target.value, due_date: addDays(e.target.value, Number(h.credit_days) || 0) })} />)}
            {lbl('เครดิต (วัน)', <input inputMode="numeric" value={h.credit_days} onChange={e => set({ credit_days: e.target.value, due_date: addDays(h.date, Number(e.target.value) || 0) })} />)}
            {lbl('ครบกำหนด', <input type="date" value={h.due_date} onChange={e => set({ due_date: e.target.value })} />)}
            {lbl(kind === 'RI' ? 'ผู้รับสินค้า' : 'ผู้สั่งซื้อ', <input value={h.purchaser} onChange={e => set({ purchaser: e.target.value })} />)}
            {lbl('สกุลเงิน', <input value="THB - ไทย" disabled />)}
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 8, marginTop: 10 }}>
          {lbl('โปรเจค', <input value={h.project} onChange={e => set({ project: e.target.value })} />)}
          {lbl('เลขที่อ้างอิง', <input value={h.ref_no} onChange={e => set({ ref_no: e.target.value })} />)}
          {lbl('ราคาสินค้า', <select value={h.price_mode} onChange={e => set({ price_mode: e.target.value })}><option value="exclusive">ราคาไม่รวมภาษี</option><option value="inclusive">ราคารวมภาษี</option></select>)}
          {lbl('คลังสินค้า', <select value={h.warehouse_id} onChange={e => set({ warehouse_id: e.target.value })}><option value="">คลังสินค้าหลัก</option>{warehouses.map(w => <option key={w.id} value={w.id}>{w.label}</option>)}</select>)}
        </div>
        <div style={{ marginTop: 8 }}>{lbl('รายละเอียด', <input value={h.description} onChange={e => set({ description: e.target.value })} />)}</div>
      </section>

      <section className="panel" style={{ padding: 12, overflowX: 'auto' }}>
        <table style={{ minWidth: 1000, width: '100%', tableLayout: 'fixed' }}><colgroup><col style={{ width: 34 }} /><col /><col style={{ width: 90 }} /><col style={{ width: 90 }} /><col style={{ width: 120 }} /><col style={{ width: 110 }} /><col style={{ width: 100 }} /><col style={{ width: 120 }} /><col style={{ width: 120 }} /><col style={{ width: 64 }} /></colgroup><thead><tr><th>#</th><th>ชื่อสินค้า / รายละเอียด</th><th>จำนวน</th><th>หน่วย</th><th>ราคาต่อหน่วย</th>
          <th>ส่วนลด <select aria-label="ชนิดส่วนลด" style={{ width: 64, padding: "2px 4px" }} value={lines[0]?.dtype} onChange={e => setLines(ls => ls.map(l => ({ ...l, dtype: e.target.value as any })))}>
            <option value="percent">%</option><option value="amount">฿</option></select></th><th>ภาษี</th><th>หัก ณ ที่จ่าย</th><th className="num">ราคารวม</th><th /></tr></thead>
          <tbody>{lines.map((l, i) => { const p = products.find(x => x.id === l.product_id); return (
            <tr key={i} style={{ verticalAlign: 'top' }}><td>{i + 1}</td>
              <td>
                <select aria-label={`สินค้า ${i + 1}`} value={l.product_id} onChange={e => pickProduct(i, e.target.value)}>
                  <option value="">เลือกสินค้า</option>{products.map(x => <option key={x.id} value={x.id}>{x.code} {x.name} (คงเหลือ {x.onhand})</option>)}</select>
                {p && <div className="sub">คงเหลือ {p.onhand} {p.unit} · {p.code}</div>}
                <textarea aria-label={`รายละเอียด ${i + 1}`} rows={1} placeholder="รายละเอียด (Shift+Enter ขึ้นบรรทัดใหม่)" value={l.description} onChange={e => setL(i, { description: e.target.value })} style={{ width: '100%' }} />
                {canCreateProduct && <button type="button" className="btn sm ghost" onClick={() => setNp({ row: i, code: '', name: '', unit: 'ชิ้น', buy: '' })}>+ เพิ่มสินค้าใหม่</button>}
              </td>
              <td><input aria-label={`จำนวน ${i + 1}`} inputMode="decimal" value={l.qty} onChange={e => setL(i, { qty: e.target.value })} /></td>
              <td><input aria-label={`หน่วย ${i + 1}`} value={l.unit} onChange={e => setL(i, { unit: e.target.value })} /></td>
              <td><input aria-label={`ราคา ${i + 1}`} inputMode="decimal" value={l.unit_price} onChange={e => setL(i, { unit_price: e.target.value })} /></td>
              <td><input aria-label={`ส่วนลด ${i + 1}`} inputMode="decimal" value={l.dval} onChange={e => setL(i, { dval: e.target.value })} /></td>
              <td><select aria-label={`ภาษี ${i + 1}`} value={l.vat} onChange={e => setL(i, { vat: e.target.value })}><option value="0">0%</option><option value="7">7%</option><option value="exempt">ยกเว้น</option></select></td>
              <td><select aria-label={`หัก ณ ที่จ่าย ${i + 1}`} value={l.wht} onChange={e => setL(i, { wht: e.target.value })}>{WHT.map(w => <option key={w} value={w}>{w === '0' ? 'ไม่หัก' : `${w}%`}</option>)}</select></td>
              <td className="num">{fmt(calc.per[i].total)}</td>
              <td>{lines.length > 1 && <button type="button" className="btn sm ghost" onClick={() => setLines(ls => ls.filter((_, j) => j !== i))}>ลบ</button>}</td></tr>); })}</tbody></table>
        <button type="button" className="btn sm ghost" style={{ marginTop: 8 }} onClick={() => setLines(ls => [...ls, blank()])}>+ เพิ่มแถวรายการ</button>
        {np && <div className="panel" style={{ padding: 10, marginTop: 8, display: 'grid', gap: 6, maxWidth: 520 }}>
          <b>สร้างสินค้านับสต็อกใหม่ (แถว {np.row + 1})</b>
          <input aria-label="รหัสสินค้าใหม่" placeholder="รหัสสินค้า" value={np.code} onChange={e => setNp({ ...np, code: e.target.value })} />
          <input aria-label="ชื่อสินค้าใหม่" placeholder="ชื่อสินค้า" value={np.name} onChange={e => setNp({ ...np, name: e.target.value })} />
          <input aria-label="หน่วยหลัก" placeholder="หน่วยหลัก" value={np.unit} onChange={e => setNp({ ...np, unit: e.target.value })} />
          <input aria-label="ราคาซื้อ" placeholder="ราคาซื้อ" inputMode="decimal" value={np.buy} onChange={e => setNp({ ...np, buy: e.target.value })} />
          <div className="acts" style={{ justifyContent: 'flex-start' }}><button type="button" className="btn sm" disabled={pending} onClick={makeProduct}>บันทึกสินค้า</button>
            <button type="button" className="btn sm ghost" onClick={() => setNp(null)}>ยกเลิก</button></div></div>}
      </section>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 12 }}>
        <section className="panel" style={{ padding: 16, display: 'grid', gap: 8, alignContent: 'start' }}>
          <label><input type="checkbox" checked={h.show_signature} onChange={e => set({ show_signature: e.target.checked })} /> ลายเซ็นอิเล็กทรอนิกส์และตรายาง</label>
          {lbl('หมายเหตุ (แสดงบนเอกสาร)', <textarea rows={3} value={h.note} onChange={e => set({ note: e.target.value })} />)}
          {lbl('โน้ตภายในบริษัท', <textarea rows={2} value={h.internal_note} onChange={e => set({ internal_note: e.target.value })} />)}
        </section>
        <section className="panel" style={{ padding: 16 }}>
          <table><tbody>
            <tr><td>รวมเป็นเงิน</td><td className="num">{fmt(calc.net + calc.disc)}</td></tr>
            <tr><td>ส่วนลดรวม</td><td className="num">{fmt(calc.disc)}</td></tr>
            <tr><td>ราคาหลังหักส่วนลด</td><td className="num">{fmt(calc.net)}</td></tr>
            <tr><td>มูลค่าที่ไม่มี/ยกเว้นภาษี</td><td className="num">{fmt(calc.ex)}</td></tr>
            <tr><td>มูลค่าที่คำนวณภาษี</td><td className="num">{fmt(calc.net - calc.ex)}</td></tr>
            <tr><td>ภาษีมูลค่าเพิ่ม</td><td className="num">{fmt(calc.vat)}</td></tr>
            <tr><td><b>จำนวนเงินรวมทั้งสิ้น</b></td><td className="num"><b>{fmt(calc.total)}</b></td></tr>
            <tr><td>หัก ณ ที่จ่ายทั้งสิ้น</td><td className="num">{fmt(calc.wht)}</td></tr>
            <tr><td>ยอดชำระ</td><td className="num">{fmt(calc.total - calc.wht)}</td></tr>
          </tbody></table>
        </section>
      </div>
      {err && <p className="sub" role="alert" style={{ color: 'var(--red)' }}>{err}</p>}
      <div className="acts" style={{ justifyContent: 'flex-start', gap: 8 }}>
        <button type="button" className="btn" disabled={pending || !ok} onClick={submit}>{pending ? '...' : 'บันทึกเอกสาร'}</button>
        <button type="button" className="btn ghost" onClick={() => router.push(back)}>ปิดหน้าต่าง</button>
      </div>
    </div>
  );
}
