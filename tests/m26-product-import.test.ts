import { describe, it, expect } from 'vitest';
import { autoMap, validateImport, fillCodes, parseDateCell, FIELDS, type FieldKey } from '../web/lib/product-import';

const H = ['ประเภทสินค้า', 'รหัสสินค้า', 'ชื่อสินค้า', 'หน่วยสินค้าหลัก', 'ราคาขาย', 'ราคาซื้อ', 'หน่วยสินค้าอื่น', 'อัตราแปลง', 'จำนวนยอดตั้งต้น', 'ต้นทุนต่อหน่วย', 'วันที่ตั้งต้น'];
const map = autoMap(H);
const v = (rows: unknown[][], ex: string[] = []) => validateImport(rows, map, new Set(ex));

describe('M26.3 นำเข้าสินค้า (ตรวจไฟล์)', () => {
  it('จับคู่หัวคอลัมน์ไทยอัตโนมัติ', () => {
    expect(map.kind).toBe(0); expect(map.code).toBe(1); expect(map.name).toBe(2); expect(map.u_unit).toBe(6); expect(map.o_date).toBe(10);
    expect(autoMap(['Product Type', 'SKU', 'Name', 'Unit']).code).toBe(1);
    expect(FIELDS.filter(f => f[2]).map(f => f[0])).toEqual(['kind', 'name', 'unit']);
  });
  it('แถวถูกต้อง 3 ประเภท', () => {
    const r = v([['บริการ', '', 'ค่าขนส่ง', '', 500], ['สินค้าไม่นับสต็อก', 'N1', 'กระดาษ', 'รีม', 100, 80], ['สินค้านับสต็อก', 'S1', 'ตะแกรง', 'แผ่น', 1850, 1400, '', '', 50, 1380, '27/10/2569']]);
    expect(r.issues).toEqual([]); expect(r.items.length).toBe(3); expect(r.ready).toBe(3);
    expect(r.items[2].open).toEqual({ qty: 50, cost: 1380, date: '2026-10-27' });
  });
  it('SKU เดียวกันหลายแถว = หน่วยสินค้าอื่น (ยอดตั้งต้นที่แถวแรก)', () => {
    const r = v([['สินค้านับสต็อก', 'S1', 'ตะแกรง', 'แผ่น', 1850, 1400, 'มัด', 10, 50, 1380, '2026-10-27'], ['สินค้านับสต็อก', 'S1', 'ตะแกรง', 'แผ่น', 1850, 1400, 'พาเลท', 100]]);
    expect(r.issues).toEqual([]); expect(r.items.length).toBe(1); expect(r.items[0].units.map(u => u.unit)).toEqual(['มัด', 'พาเลท']);
  });
  it('ข้อผิดพลาด: ข้อมูลไม่ตรง/ซ้ำในระบบ/ฟิลด์ผิดประเภท/ยอดตั้งต้นไม่ครบ', () => {
    const r = v([['สินค้านับสต็อก', 'S1', 'ก', 'แผ่น', 10], ['สินค้านับสต็อก', 'S1', 'ข', 'แผ่น', 10], ['บริการ', 'X', 'งาน', '', 10, 5], ['สินค้าไม่นับสต็อก', 'N', 'ซ', 'ชิ้น', 1, 1, 'กล่อง', 2],
      ['สินค้านับสต็อก', 'S9', 'ต', 'แผ่น', 1, 1, '', '', 5], ['สินค้านับสต็อก', 'DUP', 'ด', 'แผ่น'], ['ผิด', '', 'ง', 'ชิ้น']], ['dup']);
    const by = (n: number) => r.issues.filter(i => i.row === n).map(i => i.message).join('|');
    expect(by(2)).toContain('ไม่ตรงกับแถว 1'); expect(by(3)).toContain('ฝั่งขาย'); expect(by(4)).toContain('ไม่มียอดตั้งต้น');
    expect(by(5)).toContain('ต้นทุน'); expect(by(6)).toContain('ซ้ำกับสินค้าที่มีอยู่'); expect(by(7)).toContain('ไม่ถูกต้อง');
    expect(r.ready).toBe(1); expect(r.total).toBe(7);
  });
  it('เกิน 500 แถว / ไฟล์ว่าง / หน่วยอื่นเกิน 10', () => {
    expect(v(Array.from({ length: 501 }, () => ['บริการ', '', 'a'])).issues[0].message).toContain('500');
    expect(v([]).issues[0].message).toContain('ไม่พบข้อมูล');
    const rows = Array.from({ length: 11 }, (_, i) => ['สินค้านับสต็อก', 'S', 'ก', 'แผ่น', 1, 1, `u${i}`, i + 2]);
    expect(v(rows).issues.some(i => i.message.includes('เกิน 10'))).toBe(true);
  });
  it('กิจการไม่จด VAT เลือก VAT ขายอื่นไม่ได้ · วันที่/เติมรหัส', () => {
    const m2 = autoMap(['ประเภทสินค้า', 'ชื่อสินค้า', 'หน่วยสินค้าหลัก', 'ภาษีมูลค่าเพิ่ม (ขาย)']);
    expect(validateImport([['บริการ', 'ก', '', 'ราคารวม VAT แล้ว']], m2, new Set(), { vat: false }).issues[0].message).toContain('ไม่ได้จดทะเบียน VAT');
    expect(parseDateCell('31/02/2569')).toBeNull(); expect(parseDateCell(new Date('2026-10-27T00:00:00Z'))).toBe('2026-10-27');
    const f = fillCodes([{ code: '' } as any, { code: 'A' } as any, { code: '' } as any], new Set(['auto-0001']));
    expect(f.map(x => x.code)).toEqual(['AUTO-0002', 'A', 'AUTO-0003']);
  });
});
