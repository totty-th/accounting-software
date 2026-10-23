import { describe, it, expect } from 'vitest';
import { buildReconcileReport, monthEnd, type RLine, type RItem } from '../web/lib/bank-report';

const L = (seq: number, date: string, amount: number, balance: number | null, groupId: string | null = null): RLine =>
  ({ seq, date, description: 'x', amount, balance, groupId });
const I = (date: string, amount: number, groupId: string | null = null, no = 'JV'): RItem => ({ date, no, memo: 'm', amount, groupId });

// ฝาก 2,000 (10 ต.ค. ตรงกันทั้งสองฝั่ง) · เช็ค 500 ออก 30 ต.ค. ธนาคารตัด 3 พ.ย. · ดอกเบี้ย 20 ใน statement 15 พ.ย. ยังไม่บันทึกบัญชี
const lines = [L(1, '2026-10-10', 2000, 2000, 'g1'), L(2, '2026-11-03', -500, 1500, 'g2'), L(3, '2026-11-15', 20, 1520, null)];
const items = [I('2026-10-10', 2000, 'g1', 'RV1'), I('2026-10-30', -500, 'g2', 'PV1')];

describe('M13.3 งบกระทบยอด ณ วันที่', () => {
  it('monthEnd รองรับเดือน 28/29/30/31 วัน', () => {
    expect(monthEnd('2026-02')).toBe('2026-02-28'); expect(monthEnd('2028-02')).toBe('2028-02-29');
    expect(monthEnd('2026-10')).toBe('2026-10-31'); expect(monthEnd('2026-11')).toBe('2026-11-30');
  });
  it('สิ้น ต.ค.: เช็คที่ธนาคารตัดเดือนถัดไปเป็นรายการจ่ายที่ยังไม่ผ่านธนาคาร และผลต่างเป็น 0', () => {
    const r = buildReconcileReport(lines, items, '2026-10-31');
    expect(r.bankBalance).toBe(2000);
    expect(r.outstanding.map(i => i.no)).toEqual(['PV1']);
    expect(r.matchedLater(items[1].groupId)).toBe(true);
    expect(r.adjBank).toBe(1500);
    expect(r.bookTotal).toBe(1500);
    expect(r.unLines).toHaveLength(0);
    expect(r.adjBook).toBe(1500);
    expect(r.unexplained).toBe(0);
  });
  it('สิ้น พ.ย.: เช็คผ่านธนาคารแล้ว เหลือดอกเบี้ยที่ยังไม่บันทึกบัญชี ผลต่างยังเป็น 0', () => {
    const r = buildReconcileReport(lines, items, '2026-11-30');
    expect(r.bankBalance).toBe(1520);
    expect(r.outstanding).toHaveLength(0);
    expect(r.unLines.map(l => l.amount)).toEqual([20]);
    expect(r.adjBook).toBe(1520);
    expect(r.unexplained).toBe(0);
  });
  it('ก่อนมีรายการใดๆ ยอดเป็น 0 ทั้งหมด', () => {
    const r = buildReconcileReport(lines, items, '2026-09-30');
    expect([r.bankBalance, r.bookTotal, r.adjBank, r.adjBook, r.unexplained]).toEqual([0, 0, 0, 0, 0]);
  });
  it('ไม่มีคอลัมน์คงเหลือใช้ผลรวมรายการ ณ วันนั้น', () => {
    const r = buildReconcileReport([L(1, '2026-10-01', 300, null), L(2, '2026-10-02', -100, null)], [], '2026-10-31');
    expect(r.bankBalance).toBe(200);
  });
  it('กลุ่ม N:N ที่ข้ามเดือนทั้งกลุ่มถือว่ายังไม่ผ่านธนาคารทั้งฝั่งสมุดและ statement', () => {
    const r = buildReconcileReport(
      [L(1, '2026-10-28', 100, 100, 'g'), L(2, '2026-11-02', 50, 150, 'g')],
      [I('2026-10-29', 150, 'g', 'RV9')], '2026-10-31');
    expect(r.inTransit.map(i => i.no)).toEqual(['RV9']);
    expect(r.unLines.map(l => l.amount)).toEqual([100]);
    expect(r.unexplained).toBe(0);
  });
});
