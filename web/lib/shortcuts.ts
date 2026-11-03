// แป้นพิมพ์ลัด (Alt+key; บน Mac คือ ⌥) — รวมรายการไว้ที่เดียวให้หน้าตั้งค่ากับตัวจัดการใช้ร่วมกัน
export type Shortcut = { id: string; label: string; key: string; shift?: boolean; group: string };
export const SHORTCUTS: Shortcut[] = [
  { group: 'ทั่วไป', id: 'new-sale', label: 'สร้างเอกสารขายใหม่', key: 'N' },
  { group: 'ทั่วไป', id: 'new-contact', label: 'เพิ่มผู้ติดต่อ', key: 'C' },
  { group: 'ทั่วไป', id: 'new-product', label: 'เพิ่มรายการสินค้า', key: 'I' },
  { group: 'ทั่วไป', id: 'print', label: 'พิมพ์', key: 'P' },
  { group: 'ทั่วไป', id: 'save', label: 'บันทึกเอกสาร', key: 'S' },
  { group: 'ทั่วไป', id: 'save-close', label: 'บันทึกและปิด', key: 'S', shift: true },
  { group: 'ทั่วไป', id: 'close', label: 'ปิดหน้าต่าง (ย้อนกลับ)', key: 'Q' },
];
export const keyOf = (s: Shortcut) => (s.shift ? 'Shift+' : '') + 'Alt+' + s.key;
export function matchShortcut(e: { altKey: boolean; shiftKey: boolean; code: string }): Shortcut | undefined {
  if (!e.altKey) return undefined;
  return SHORTCUTS.find(s => e.code === 'Key' + s.key && !!s.shift === e.shiftKey);
}
