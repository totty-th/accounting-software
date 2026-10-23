import { describe, it, expect } from 'vitest';
import { parseStatementCsv, parseDate } from '../web/lib/bank-csv';

describe('M13 แปลง CSV รายการเดินบัญชี', () => {
  it('อ่านไฟล์ตัวอย่าง (วันที่,รายละเอียด,ถอน,ฝาก,คงเหลือ)', () => {
    const r = parseStatementCsv('﻿วันที่,รายละเอียด,ถอน,ฝาก,คงเหลือ\n2026-10-21,ดอกเบี้ยรับ,,500,500\n22/10/2569,"ค่าธรรมเนียม, โอน",35,,465\n');
    expect(r).toEqual([
      { date: '2026-10-21', description: 'ดอกเบี้ยรับ', deposit: 500, withdrawal: 0, balance: 500 },
      { date: '2026-10-22', description: 'ค่าธรรมเนียม, โอน', deposit: 0, withdrawal: 35, balance: 465 }]);
  });
  it('ตัวเลขมีจุลภาค และคอลัมน์สลับลำดับ', () => {
    const r = parseStatementCsv('ฝาก,ถอน,วันที่\n"3,210.50",,2026-10-23');
    expect(r[0]).toMatchObject({ deposit: 3210.5, withdrawal: 0, date: '2026-10-23', balance: null });
  });
  it('ปฏิเสธวันที่/ตัวเลขผิดและแจ้งเลขแถว', () => {
    expect(() => parseStatementCsv('วันที่,ถอน,ฝาก\n2026-13-40,1,')).toThrow('แถวที่ 1');
    expect(() => parseStatementCsv('วันที่,ถอน,ฝาก\n2026-10-01,abc,')).toThrow('แถวที่ 1');
    expect(() => parseStatementCsv('a,b\n1,2')).toThrow('ไม่พบคอลัมน์');
    expect(() => parseDate('31/02/2026')).toThrow();
  });
});
