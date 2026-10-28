'use client';
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { deleteProduct } from '@/lib/actions';
import { money, qty } from '@/lib/format';

export type PRow = { id: string; code: string; name: string; kind: string; base_unit: string; sale_price: number; purchase_price: number; category: string | null; barcode: string | null;
  description: string | null; is_active: boolean; onhand: number | null; units: string };
const ICON: Record<string, { t: string; l: string }> = { service: { t: '🛎', l: 'บริการ' }, goods_nostock: { t: '📦', l: 'สินค้าไม่นับสต็อก' }, goods_stock: { t: '🏷', l: 'สินค้านับสต็อก' } };

/** ตารางรายการสินค้า (แบบ FA): ติ๊กเลือกหลายรายการ → ชิป "เลือก N รายการ ✕" + ดาวน์โหลด Excel เฉพาะที่เลือก · เมนู … = แก้ไข/สร้างซ้ำ/ลบ · ติดลบแสดงสีแดงในวงเล็บ */
export function ProductTable({ rows, canWrite, showCost, sortHref, sort, dir, exportBase }: {
  rows: PRow[]; canWrite: boolean; showCost: boolean; sortHref: { name: string; price: string }; sort: string; dir: string; exportBase: string;
}) {
  const r = useRouter();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<string | null>(null);
  const [del, setDel] = useState<PRow | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const all = rows.length > 0 && sel.size === rows.length;
  const toggle = (id: string) => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const arrow = (k: string) => (sort === k ? (dir === 'desc' ? ' ▾' : ' ▴') : '');
  const exportHref = `/products/export?${exportBase}${sel.size ? `&ids=${[...sel].join(',')}` : ''}`;
  const confirmDel = () => start(async () => {
    const x = await deleteProduct(del!.id); setDel(null);
    if (x.error) setMsg(x.error); else { setSel(s => { const n = new Set(s); n.delete(del!.id); return n; }); r.refresh(); }
  });
  return (
    <>
      <div className="noprint" style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8, minHeight: 30 }}>
        {sel.size > 0 && <span className="pill blue" style={{ display: 'inline-flex', gap: 8, minWidth: 0, alignItems: 'center' }}>เลือก {sel.size} รายการ <button type="button" aria-label="ล้างการเลือก" onClick={() => setSel(new Set())} style={{ background: 'none', border: 0, color: '#fff', cursor: 'pointer', padding: 0 }}>✕</button></span>}
        <a className="btn sm ghost" href={exportHref} title={sel.size ? 'ดาวน์โหลด Excel เฉพาะที่เลือก' : 'ดาวน์โหลด Excel ตามตัวกรองที่แสดง'}>⬇ ดาวน์โหลด Excel{sel.size ? ` (${sel.size})` : ''}</a>
      </div>
      {msg && <div className="toast" role="alert" onClick={() => setMsg(null)}>{msg}</div>}
      <div className="panel" style={{ padding: 0, overflowX: 'auto' }}>
        {rows.length === 0 ? <div className="empty">ไม่พบสินค้า{canWrite && <> · <Link href="/products/new">กดที่นี่เพื่อสร้างสินค้าแรกของคุณ</Link></>}</div> :
          <table><thead><tr>
            <th style={{ width: 34 }}><input type="checkbox" aria-label="เลือกทั้งหมด" checked={all} onChange={() => setSel(all ? new Set() : new Set(rows.map(x => x.id)))} /></th>
            <th>รหัสสินค้า</th>
            <th><Link href={sortHref.name}>ชื่อสินค้า{arrow('name')}</Link></th>
            <th className="num"><Link href={sortHref.price}>ราคาต่อหน่วย{arrow('price')}</Link></th>{showCost && <th className="num">ราคาซื้อ</th>}
            <th className="num">จำนวนคงคลัง</th><th>หมวดสินค้า</th><th style={{ width: 48 }} /></tr></thead>
            <tbody>{rows.map(x => {
              const neg = x.onhand != null && Number(x.onhand) < 0;
              const tip = (x.units ?? '').split(';').filter(Boolean).map(s => { const [u, f] = s.split('|'); return `≈ ${qty(Number(x.onhand) / Number(f))} ${u}`; }).join(' · ');
              return (
                <tr key={x.id} style={x.is_active ? undefined : { opacity: 0.55 }}>
                  <td><input type="checkbox" aria-label={`เลือก ${x.name}`} checked={sel.has(x.id)} onChange={() => toggle(x.id)} /></td>
                  <td className="no"><span title={ICON[x.kind].l} aria-label={ICON[x.kind].l} style={{ marginRight: 6 }}>{ICON[x.kind].t}</span>{x.code}</td>
                  <td><Link href={`/products/${x.id}`}>{x.name}</Link>{!x.is_active && <span className="sub"> (ปิดใช้งาน)</span>}
                    {(x.description || x.barcode) && <div className="sub" style={{ whiteSpace: 'pre-line' }}>{x.description || x.barcode}</div>}</td>
                  <td className="num">{money(x.sale_price)}</td>{showCost && <td className="num">{money(x.purchase_price)}</td>}
                  <td className="num">{x.onhand == null ? '-' : <span style={{ color: neg ? 'var(--red)' : undefined }} title={tip}>{neg ? `(${qty(Math.abs(Number(x.onhand)))})` : qty(x.onhand)}<div className="sub" style={{ color: neg ? 'var(--red)' : undefined }}>{x.base_unit}{tip && <span aria-hidden> ⓘ</span>}</div></span>}</td>
                  <td>{x.category ?? ''}</td>
                  <td style={{ position: 'relative' }} data-noclick>
                    {canWrite && <><button type="button" className="btn sm ghost" aria-label={`เมนู ${x.name}`} aria-expanded={menu === x.id} onClick={() => setMenu(menu === x.id ? null : x.id)}>•••</button>
                      {menu === x.id && <><div style={{ position: 'fixed', inset: 0, zIndex: 20 }} onClick={() => setMenu(null)} />
                        <div role="menu" className="panel" style={{ position: 'absolute', right: 6, top: '70%', zIndex: 21, minWidth: 150, padding: 4, display: 'grid', gap: 2 }}>
                          <Link role="menuitem" className="btn sm ghost" href={`/products/${x.id}/edit`} style={{ textAlign: 'left' }}>✎ แก้ไข</Link>
                          <Link role="menuitem" className="btn sm ghost" href={`/products/new?from=${x.id}`} style={{ textAlign: 'left' }}>⧉ สร้างซ้ำ</Link>
                          <button role="menuitem" type="button" className="btn sm ghost" style={{ textAlign: 'left', color: 'var(--red)' }} onClick={() => { setMenu(null); setDel(x); }}>🗑 ลบสินค้า</button></div></>}</>}
                  </td></tr>);
            })}</tbody></table>}
      </div>
      {del && <div role="dialog" aria-modal="true" aria-label="ยืนยันการลบข้อมูล" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', zIndex: 50, display: 'grid', placeItems: 'center' }}>
        <div className="panel" style={{ maxWidth: 380, borderTop: '5px solid var(--red)', textAlign: 'center' }}>
          <h3 style={{ marginTop: 0 }}>ยืนยันการลบข้อมูล</h3>
          <p>คุณกำลังลบ <b>{del.name}</b> ต้องการดำเนินการต่อหรือไม่?<br /><span className="sub">ลบไม่ได้ถ้าสินค้าถูกใช้ในเอกสารหรือมีสต็อกเคลื่อนไหวแล้ว</span></p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}><button className="btn ghost" onClick={() => setDel(null)}>ปิด</button><button className="btn danger" disabled={pending} onClick={confirmDel}>{pending ? '...' : 'ลบข้อมูล'}</button></div></div></div>}
    </>
  );
}
