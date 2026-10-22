'use client';
import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

type Opt = { id: string; label: string };
type Prod = { id: string; label: string; price: number; kind: string };
type Line = { product: string; desc: string; qty: string; price: string };
type Result = { error?: string; ok?: true };

const money = (n: number) => n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const r2 = (x: number) => Math.round(x * 100) / 100;

export function SalesDocForm({ type, title, customers, products, today, action }: {
  type: string; title: string; customers: Opt[]; products: Prod[]; today: string;
  action: (p: any) => Promise<Result>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [contact, setContact] = useState(type === 'CA' ? '' : customers[0]?.id ?? '');
  const [date, setDate] = useState(today);
  const [mode, setMode] = useState('exclusive');
  const [lines, setLines] = useState<Line[]>([{ product: '', desc: '', qty: '1', price: '' }]);

  const set = (i: number, patch: Partial<Line>) => setLines(ls => ls.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const pick = (i: number, id: string) => {
    const p = products.find(x => x.id === id);
    set(i, { product: id, desc: p ? p.label : lines[i].desc, price: p ? String(p.price) : lines[i].price });
  };
  const t = useMemo(() => {
    const gross = lines.reduce((s, l) => s + r2((+l.qty || 0) * (+l.price || 0)), 0);
    if (mode === 'exclusive') { const vat = r2(gross * 0.07); return { net: gross, vat, total: gross + vat }; }
    const net = r2(gross * 100 / 107); return { net, vat: r2(gross - net), total: gross };
  }, [lines, mode]);

  const submit = () => start(async () => {
    setErr(null);
    const payload = {
      type, date, contact: contact || null, mode,
      lines: lines.filter(l => l.desc && +l.qty > 0).map(l => ({
        description: l.desc, product_id: l.product || undefined, kind: 'service', qty: +l.qty, unit_price: +l.price || 0 })),
    };
    if (!payload.lines.length) return setErr('ใส่รายการอย่างน้อย 1 บรรทัด');
    const r = await action(payload);
    if (r.error) return setErr(r.error);
    router.push('/sales?type=' + type);
  });

  return (
    <div className="panel">
      <h2 style={{ marginTop: 0 }}>{title}</h2>
      <div className="grid">
        <label className="f">ลูกค้า
          <select value={contact} onChange={e => setContact(e.target.value)}>
            {type === 'CA' && <option value="">Cash Sale (ลูกค้าทั่วไป)</option>}
            {customers.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </label>
        <label className="f">วันที่เอกสาร<input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
        <label className="f">ราคา
          <select value={mode} onChange={e => setMode(e.target.value)}>
            <option value="exclusive">ไม่รวม VAT 7%</option><option value="inclusive">รวม VAT 7% แล้ว</option>
          </select>
        </label>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="lines" style={{ minWidth: 640 }}>
          <thead><tr><th style={{ width: '24%' }}>สินค้า/บริการ</th><th>รายละเอียด</th><th style={{ width: 90 }} className="num">จำนวน</th><th style={{ width: 130 }} className="num">ราคาต่อหน่วย</th><th className="num" style={{ width: 120 }}>รวม</th><th style={{ width: 36 }} /></tr></thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td><select value={l.product} onChange={e => pick(i, e.target.value)}>
                  <option value="">พิมพ์เอง</option>{products.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</select></td>
                <td><input value={l.desc} onChange={e => set(i, { desc: e.target.value })} placeholder="รายละเอียด" /></td>
                <td><input className="num" inputMode="decimal" value={l.qty} onChange={e => set(i, { qty: e.target.value })} /></td>
                <td><input className="num" inputMode="decimal" value={l.price} onChange={e => set(i, { price: e.target.value })} /></td>
                <td className="num">{money((+l.qty || 0) * (+l.price || 0))}</td>
                <td><button type="button" className="btn sm ghost" onClick={() => setLines(ls => ls.length > 1 ? ls.filter((_, k) => k !== i) : ls)} aria-label="ลบบรรทัด">×</button></td>
              </tr>))}
          </tbody>
        </table>
      </div>
      <button type="button" className="btn sm ghost" onClick={() => setLines(ls => [...ls, { product: '', desc: '', qty: '1', price: '' }])}>+ เพิ่มบรรทัด</button>
      <div className="totals">
        <div><span>มูลค่าก่อนภาษี</span><span>{money(t.net)}</span></div>
        <div><span>VAT 7%</span><span>{money(t.vat)}</span></div>
        <div className="t"><span>ยอดรวมสุทธิ</span><span>{money(t.total)}</span></div>
      </div>
      {err && <div className="notice" role="alert" style={{ borderLeftColor: 'var(--red)', marginTop: 14 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button className="btn" disabled={pending} onClick={submit}>{pending ? 'กำลังบันทึก...' : 'บันทึก'}</button>
        <button className="btn ghost" onClick={() => router.back()}>ยกเลิก</button>
      </div>
    </div>
  );
}

export function ExpenseForm({ vendors, accounts, today, action }: {
  vendors: Opt[]; accounts: Opt[]; today: string; action: (p: any) => Promise<Result>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [contact, setContact] = useState(vendors[0]?.id ?? '');
  const [date, setDate] = useState(today);
  type L = { desc: string; account: string; qty: string; price: string; vat: string; wht: string };
  const blank: L = { desc: '', account: accounts[0]?.id ?? '', qty: '1', price: '', vat: '7', wht: '0' };
  const [lines, setLines] = useState<L[]>([blank]);
  const set = (i: number, p: Partial<L>) => setLines(ls => ls.map((l, k) => (k === i ? { ...l, ...p } : l)));
  const tot = lines.reduce((a, l) => {
    const net = r2((+l.qty || 0) * (+l.price || 0));
    return { net: a.net + net, vat: a.vat + r2(net * (+l.vat || 0) / 100), wht: a.wht + r2(net * (+l.wht || 0) / 100) };
  }, { net: 0, vat: 0, wht: 0 });
  const submit = () => start(async () => {
    setErr(null);
    const ls = lines.filter(l => l.desc && +l.qty > 0).map(l => ({ description: l.desc, account: l.account, qty: +l.qty,
      unit_price: +l.price || 0, vat_rate: +l.vat, wht_rate: +l.wht }));
    if (!ls.length) return setErr('ใส่รายการอย่างน้อย 1 บรรทัด');
    const r = await action({ date, contact, lines: ls });
    if (r.error) return setErr(r.error);
    router.push('/expenses');
  });
  return (
    <div className="panel">
      <h2 style={{ marginTop: 0 }}>ค่าใช้จ่ายใหม่</h2>
      <div className="grid">
        <label className="f">ผู้ขาย<select value={contact} onChange={e => setContact(e.target.value)}>{vendors.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}</select></label>
        <label className="f">วันที่<input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="lines" style={{ minWidth: 760 }}>
          <thead><tr><th>รายการ</th><th style={{ width: '20%' }}>บัญชี</th><th className="num" style={{ width: 70 }}>จำนวน</th><th className="num" style={{ width: 120 }}>ราคาต่อหน่วย</th><th style={{ width: 90 }}>VAT</th><th style={{ width: 100 }}>หัก ณ ที่จ่าย</th><th style={{ width: 36 }} /></tr></thead>
          <tbody>{lines.map((l, i) => (
            <tr key={i}>
              <td><input value={l.desc} onChange={e => set(i, { desc: e.target.value })} placeholder="เช่น ค่าเช่า" /></td>
              <td><select value={l.account} onChange={e => set(i, { account: e.target.value })}>{accounts.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}</select></td>
              <td><input className="num" inputMode="decimal" value={l.qty} onChange={e => set(i, { qty: e.target.value })} /></td>
              <td><input className="num" inputMode="decimal" value={l.price} onChange={e => set(i, { price: e.target.value })} /></td>
              <td><select value={l.vat} onChange={e => set(i, { vat: e.target.value })}><option value="7">7%</option><option value="0">ไม่มี</option></select></td>
              <td><select value={l.wht} onChange={e => set(i, { wht: e.target.value })}><option value="0">ไม่หัก</option><option value="1">1%</option><option value="3">3%</option><option value="5">5%</option><option value="0.5">0.5%</option></select></td>
              <td><button type="button" className="btn sm ghost" aria-label="ลบบรรทัด" onClick={() => setLines(ls => ls.length > 1 ? ls.filter((_, k) => k !== i) : ls)}>×</button></td>
            </tr>))}</tbody>
        </table>
      </div>
      <button type="button" className="btn sm ghost" onClick={() => setLines(ls => [...ls, blank])}>+ เพิ่มบรรทัด</button>
      <div className="totals">
        <div><span>มูลค่าก่อนภาษี</span><span>{money(tot.net)}</span></div>
        <div><span>VAT</span><span>{money(tot.vat)}</span></div>
        <div><span>ยอดรวม</span><span>{money(tot.net + tot.vat)}</span></div>
        <div><span>หัก ณ ที่จ่าย</span><span>- {money(tot.wht)}</span></div>
        <div className="t"><span>จ่ายสุทธิ</span><span>{money(tot.net + tot.vat - tot.wht)}</span></div>
      </div>
      {err && <div className="notice" role="alert" style={{ borderLeftColor: 'var(--red)', marginTop: 14 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button className="btn" disabled={pending} onClick={submit}>{pending ? 'กำลังบันทึก...' : 'บันทึก'}</button>
        <button className="btn ghost" onClick={() => router.back()}>ยกเลิก</button>
      </div>
    </div>
  );
}
