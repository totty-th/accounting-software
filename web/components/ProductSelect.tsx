'use client';
import { useMemo, useState } from 'react';
import { matcher, hayOf } from '@/lib/product-match';
import { ProductFilterChips, chipOk, NO_CHIP, type ChipF } from './ProductFilterChips';

type P = { id: string; code: string; name: string; category?: string | null; unit?: string; onhand?: number };
/** ช่องเลือกสินค้าแบบค้นหา (แทน select ยาวหลักพันรายการ) · หลายคำ ลำดับใดก็ได้ + ชิปกรอง */
export function ProductSelect({ label, products, value, disabled, onPick }: { label: string; products: P[]; value: string; disabled?: boolean; onPick: (id: string) => void }) {
  const cur = products.find(p => p.id === value);
  const [open, setOpen] = useState(false), [q, setQ] = useState(''), [cf, setCf] = useState<ChipF>(NO_CHIP);
  const hit = useMemo(() => (open ? (m => products.filter(p => m(hayOf(p))))(matcher(q)) : []), [open, products, q]);
  const list = hit.filter(p => chipOk(p, cf)).slice(0, 50);
  return (
    <div style={{ position: 'relative', minWidth: 220 }}>
      <input aria-label={label} disabled={disabled} autoComplete="off" placeholder="ค้นหา ชื่อ/รหัสสินค้า เช่น 304 หนา 1.5 รู 5"
        value={open ? q : cur ? `${cur.code} ${cur.name}` : ''} style={{ width: '100%' }}
        onFocus={() => { setOpen(true); setQ(''); }} onBlur={() => setOpen(false)} onChange={e => setQ(e.target.value)} />
      {open && <div role="listbox" style={{ position: 'absolute', zIndex: 20, left: 0, right: 0, minWidth: 'min(560px, 90vw)', background: 'var(--panel, #fff)', border: '1px solid var(--line, #ccc)', borderRadius: 6, boxShadow: '0 6px 18px rgba(0,0,0,.15)', maxHeight: 380, overflow: 'auto' }}>
        <ProductFilterChips products={hit} f={cf} onChange={setCf} />
        {list.length === 0 && <div className="sub" style={{ padding: '8px 10px' }}>ไม่พบสินค้า</div>}
        {hit.length > 50 && <div className="sub" style={{ padding: '4px 10px' }}>พบ {hit.filter(p => chipOk(p, cf)).length} รายการ แสดง 50 รายการแรก</div>}
        {list.map(p => <div key={p.id} role="option" aria-selected={p.id === value} aria-label={p.name} style={{ padding: '6px 10px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', gap: 8 }}
          onMouseDown={e => { e.preventDefault(); onPick(p.id); setOpen(false); (e.currentTarget.closest('div[role=listbox]')?.previousElementSibling as HTMLInputElement | null)?.blur(); }}>
          <span>{p.name}<small className="sub" style={{ display: 'block' }}>รหัสสินค้า: {p.code}</small></span>
          {p.onhand != null && <span className="sub" style={{ whiteSpace: 'nowrap' }}>คงเหลือ {p.onhand} {p.unit ?? ''}</span>}</div>)}
      </div>}
    </div>
  );
}
