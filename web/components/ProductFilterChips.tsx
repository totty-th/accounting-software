'use client';
import { attrsOf, type Attrs } from '@/lib/product-match';

export type ChipF = { cat: string; material: string; sheet: string };
export const NO_CHIP: ChipF = { cat: '', material: '', sheet: '' };
type P = { name: string; category?: string | null };

/** กรองตามชิป (หมวด/วัสดุ/ขนาดแผ่น) — ใช้คู่กับ matcher ในช่องเลือกสินค้าของเอกสาร */
export const chipOk = (p: P, f: ChipF) => {
  if (f.cat && (p.category ?? '') !== f.cat) return false;
  if (!f.material && !f.sheet) return true;
  const a: Attrs = attrsOf(p.name);
  return (!f.material || a.material === f.material) && (!f.sheet || a.sheet === f.sheet);
};

/** แถวชิปกรองด้านบนรายการแนะนำ · ใช้ onMouseDown + preventDefault ไม่ให้ช่องค้นหาหลุดโฟกัส */
export function ProductFilterChips({ products, f, onChange }: { products: P[]; f: ChipF; onChange: (f: ChipF) => void }) {
  const count = (vals: string[]) => { const m = new Map<string, number>(); vals.filter(Boolean).forEach(v => m.set(v, (m.get(v) ?? 0) + 1)); return [...m.entries()].sort((a, b) => b[1] - a[1]); };
  const cats = count(products.map(p => p.category ?? ''));
  if (products.length < 30 && !f.cat && !f.material && !f.sheet) return null;   // สินค้าน้อย ไม่ต้องมีตัวกรอง
  const at = products.map(p => attrsOf(p.name));
  const groups: [keyof ChipF, string, [string, number][]][] = [
    ['cat', 'หมวด', cats], ['material', 'วัสดุ', count(at.map(a => a.material))], ['sheet', 'ขนาด', count(at.map(a => a.sheet)).slice(0, 6)]];
  const chip = (k: keyof ChipF, v: string, label: string) => (
    <button key={k + v} type="button" className={`chip${f[k] === v ? ' on' : ''}`} aria-pressed={f[k] === v}
      onMouseDown={e => { e.preventDefault(); onChange({ ...f, [k]: f[k] === v ? '' : v }); }}>{label}</button>);
  return (
    <div className="chips" style={{ padding: '6px 8px', borderBottom: '1px solid var(--line, #ddd)', display: 'grid', gap: 4 }}>
      {groups.filter(([k, , vs]) => vs.length > 1 || !!f[k]).map(([k, l, vs]) => (
        <div key={k} style={{ display: 'flex', gap: 4, flexWrap: 'nowrap', overflowX: 'auto', alignItems: 'center' }}>
          <span className="sub" style={{ minWidth: 34 }}>{l}</span>{vs.map(([v]) => chip(k, v, v))}</div>))}
    </div>
  );
}
