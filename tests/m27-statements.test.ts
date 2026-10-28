import { describe, it, expect } from 'vitest';
import { buildBalanceSheet, buildPnl, bsClass } from '../web/lib/statements';

const bs = [
  { section: 'asset', code: '11112', name: 'เงินสดและเงินฝากธนาคาร', amount: 1000 }, { section: 'asset', code: '11122.01', name: 'กสิกร', amount: 500 },
  { section: 'asset', code: '11311', name: 'ลูกหนี้การค้า', amount: 300 }, { section: 'asset', code: '17111', name: 'ภาษีซื้อ', amount: 70 },
  { section: 'liability', code: '21311', name: 'เจ้าหนี้การค้า', amount: 400 }, { section: 'liability', code: '27111', name: 'ภาษีขาย', amount: 100 },
  { section: 'equity', code: '31000', name: 'ทุนเรือนหุ้น', amount: 1000 }, { section: 'equity', code: '32000', name: 'กำไรสะสม', amount: 50 },
  { section: 'equity', code: '', name: 'กำไร(ขาดทุน)สะสมงวดปัจจุบัน', amount: 320 },
];
describe('M27.2 จัดกลุ่มงบ', () => {
  it('จับคู่รหัสบัญชี → หัวข้อ/กลุ่มตาม FA', () => {
    expect(bsClass('asset', '11122.01')).toEqual(['สินทรัพย์หมุนเวียน', 'เงินสดและรายการเทียบเท่าเงินสด']);
    expect(bsClass('asset', '17111')).toEqual(['สินทรัพย์ทางภาษี', 'สินทรัพย์ทางภาษีหมุนเวียน']);
    expect(bsClass('liability', '27124')).toEqual(['หนี้สินทางภาษี', 'หนี้สินทางภาษีหมุนเวียน']);
    expect(bsClass('asset', '99999')[0]).toBe('สินทรัพย์หมุนเวียน');           // ไม่รู้จัก → กลุ่มสำรอง
  });
  it('งบฐานะการเงิน: รวมกลุ่ม/หัวข้อ · สินทรัพย์ = หนี้สิน + ส่วนของผู้ถือหุ้น', () => {
    const r = buildBalanceSheet(bs, null);
    expect(r.asset.amount).toBe(1870); expect(r.liability.amount).toBe(500); expect(r.equity.amount).toBe(1370);
    expect(r.asset.amount).toBe(r.liability.amount + r.equity.amount);
    const cur = r.asset.sections[0]; expect(cur.name).toBe('สินทรัพย์หมุนเวียน');
    expect(cur.groups.map(g => [g.name, g.amount])).toEqual([['เงินสดและรายการเทียบเท่าเงินสด', 1500], ['ลูกหนี้การค้าและลูกหนี้หมุนเวียนอื่น', 300]]);
    expect(r.asset.sections.map(s => s.name)).toEqual(['สินทรัพย์หมุนเวียน', 'สินทรัพย์ทางภาษี']);
    const eq = r.equity.sections[0].groups.find(g => g.name === 'กำไร (ขาดทุน) สะสม')!;
    expect(eq.lines.map(l => l.name)).toContain('กำไร (ขาดทุน) สะสม - รายงาน'); expect(eq.amount).toBe(370);
  });
  it('เปรียบเทียบรอบก่อน + แสดงยอดศูนย์', () => {
    const prev = [{ section: 'asset', code: '11112', name: 'เงินสดและเงินฝากธนาคาร', amount: 200 }];
    const r = buildBalanceSheet(bs, prev, [{ code: '11111', name: 'เงินสดในมือ', type: 'asset' }]);
    const cash = r.asset.sections[0].groups[0]; expect(cash.prev).toBe(200); expect(cash.lines.some(l => l.code === '11111' && l.amount === 0)).toBe(true);
    expect(r.asset.prev).toBe(200);
  });
  it('งบกำไรขาดทุน: รายได้สุทธิ/รายได้อื่น/ค่าใช้จ่ายตามหัวข้อ · กำไรสุทธิ · รับคืนติดลบ', () => {
    const rows = [
      { section: 'revenue', code: '41110', name: 'รายได้จากการขายสินค้า', amount: 1000 }, { section: 'revenue', code: '41400', name: 'รับคืนและส่วนลดจ่าย', amount: -100 },
      { section: 'revenue', code: '49010', name: 'ดอกเบี้ยรับ', amount: 20 }, { section: 'expense', code: '51100', name: 'ต้นทุนขาย', amount: 600 },
      { section: 'expense', code: '53102', name: 'ค่าเช่า', amount: 50 }, { section: 'expense', code: '59910', name: 'เบ็ดเตล็ด', amount: 5 },
    ];
    const p = buildPnl(rows, null);
    expect(p.revenue.sections.map(s => [s.name, s.amount])).toEqual([['รายได้สุทธิ', 900], ['รายได้อื่น', 20]]);
    expect(p.expense.sections.map(s => s.name)).toEqual(['ต้นทุนขายสุทธิ', 'ค่าใช้จ่ายในการบริหาร', 'ค่าใช้จ่ายอื่น']);
    expect(p.net).toBe(265);
  });
});
