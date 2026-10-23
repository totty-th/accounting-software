import { describe, it, expect } from 'vitest';
import { splitByAccount } from '../web/lib/aging-accounts';

describe('M8 แยกยอดค้างตามบัญชี', () => {
  it('ลูกหนี้: ใบเสร็จยังไม่รับเงินย้ายไป 11319 ส่วนที่เหลืออยู่ 11311', () => {
    expect(splitByAccount('ar', { doc_type: 'INV', outstanding: 10700, receipted: 4000, collected: 0 })).toEqual({ '11311': 6700, '11319': 4000 });
  });
  it('ลูกหนี้: รับเงินแล้วบางส่วน ยอดที่เหลืออยู่ 11311 ทั้งหมด', () => {
    expect(splitByAccount('ar', { doc_type: 'INV', outstanding: 6700, receipted: 4000, collected: 4000 })).toEqual({ '11311': 6700, '11319': 0 });
  });
  it('ลูกหนี้: ขายสดรอเก็บเงินอยู่ 11319 ทั้งก้อน', () => {
    expect(splitByAccount('ar', { doc_type: 'CA', outstanding: 5350, receipted: 0, collected: 0 })).toEqual({ '11311': 0, '11319': 5350 });
  });
  it('เจ้าหนี้: แยกตามบัญชีที่ค้าง', () => {
    expect(splitByAccount('ap', { outstanding: 100, liability_account: '21311' })).toEqual({ '21311': 100, '21399': 0 });
    expect(splitByAccount('ap', { outstanding: 100, liability_account: '21399' })).toEqual({ '21311': 0, '21399': 100 });
  });
});
