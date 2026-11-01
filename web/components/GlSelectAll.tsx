'use client';
/** ช่องติ๊กเลือกทั้งหน้า (ใช้คู่กับ input[data-sel] ของแต่ละแถว) */
export function GlSelectAll() {
  return <input type="checkbox" style={{ width: 'auto' }} aria-label="เลือกทั้งหมด" onChange={e => document.querySelectorAll<HTMLInputElement>('input[data-sel]').forEach(i => { i.checked = e.target.checked; })} />;
}
