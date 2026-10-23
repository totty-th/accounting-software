import { describe, it, expect } from 'vitest';
import { suggestMatches, type SLine, type SItem } from '../web/lib/bank-suggest';

const L = (id: string, date: string, description: string, amount: number, matched = false): SLine => ({ id, date, description, amount, matched });
const I = (id: string, date: string, no: string, memo: string, amount: number, matched = false): SItem => ({ id, date, no, memo, amount, matched });

describe('M13.2 แนะนำจับคู่อัตโนมัติ', () => {
  it('จับ 1:1 ยอดเท่ากัน + ข้อความใกล้เคียง = ความมั่นใจสูง', () => {
    const s = suggestMatches([L('l1', '2026-10-23', 'รับโอนจากลูกค้า', 3210)], [I('i1', '2026-10-23', 'JV-1', 'รับชำระจากลูกค้า', 3210)]);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ lineIds: ['l1'], itemIds: ['i1'], confidence: 'high' });
  });
  it('ยอดเงินออก (ติดลบ) จับได้ และทศนิยมไม่เพี้ยน', () => {
    const s = suggestMatches([L('l1', '2026-10-22', 'ค่าธรรมเนียมโอน', -35.1)], [I('i1', '2026-10-22', 'JV-2', 'ค่าธรรมเนียมโอน', -35.1)]);
    expect(s[0].confidence).toBe('high');
    expect(suggestMatches([L('l1', '2026-10-22', 'x', 0.3)], [I('i1', '2026-10-22', 'n', 'y', 0.1 + 0.2)])).toHaveLength(1);
  });
  it('ยอดเท่ากันแต่ห่างเกินช่วงวัน ไม่แนะนำ', () => {
    expect(suggestMatches([L('l1', '2026-10-01', 'a', 100)], [I('i1', '2026-10-30', 'n', 'a', 100)])).toHaveLength(0);
  });
  it('รายการที่จับคู่แล้วไม่ถูกแนะนำ', () => {
    expect(suggestMatches([L('l1', '2026-10-01', 'a', 100, true)], [I('i1', '2026-10-01', 'n', 'a', 100)])).toHaveLength(0);
    expect(suggestMatches([L('l1', '2026-10-01', 'a', 100)], [I('i1', '2026-10-01', 'n', 'a', 100, true)])).toHaveLength(0);
  });
  it('ยอดเท่ากันหลายตัวเลือก: ไม่ซ้ำกันใช้รายการเดียวสองครั้ง และลดความมั่นใจ', () => {
    const s = suggestMatches(
      [L('l1', '2026-10-10', 'โอน', 500), L('l2', '2026-10-11', 'โอน', 500)],
      [I('i1', '2026-10-10', 'a', 'อื่น', 500), I('i2', '2026-10-11', 'b', 'อื่น', 500)]);
    expect(s).toHaveLength(2);
    expect(new Set(s.flatMap(x => x.itemIds)).size).toBe(2);
    expect(s.every(x => x.confidence !== 'high')).toBe(true);
    expect(s[0].reason).toContain('ตัวเลือกอื่น');
  });
  it('รายการธนาคารเดียว = ผลรวมเอกสารหลายใบ', () => {
    const s = suggestMatches([L('l1', '2026-10-10', 'ฝากรวม', 1000)],
      [I('i1', '2026-10-09', 'a', 'x', 400), I('i2', '2026-10-10', 'b', 'y', 600), I('i3', '2026-10-10', 'c', 'z', 77)]);
    expect(s).toHaveLength(1);
    expect(s[0].itemIds.sort()).toEqual(['i1', 'i2']);
    expect(s[0].confidence).toBe('medium');
  });
  it('เอกสารเดียว = ผลรวมรายการธนาคารหลายบรรทัด', () => {
    const s = suggestMatches([L('l1', '2026-10-10', 'a', 300), L('l2', '2026-10-11', 'b', 200)], [I('i1', '2026-10-11', 'n', 'm', 500)]);
    expect(s[0].lineIds.sort()).toEqual(['l1', 'l2']);
    expect(s[0].itemIds).toEqual(['i1']);
  });
  it('รายการที่หาคู่ไม่ได้ไม่ปรากฏในคำแนะนำ และเรียงมั่นใจสูงก่อน', () => {
    const s = suggestMatches(
      [L('l1', '2026-10-10', 'อะไรสักอย่าง', 111), L('l2', '2026-10-10', 'รับโอนจากลูกค้า', 3210), L('l3', '2026-10-10', 'ไม่มีคู่', 9)],
      [I('i1', '2026-10-19', 'a', 'ไม่เกี่ยว', 111), I('i2', '2026-10-10', 'b', 'รับชำระจากลูกค้า', 3210)]);
    expect(s.map(x => x.lineIds[0])).toEqual(['l2', 'l1']);
    expect(s[1].confidence).toBe('low');
  });
});
