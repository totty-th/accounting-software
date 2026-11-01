import { describe, it, expect } from 'vitest';
import { claimDeadline, claimBucket, vatKey } from '../web/lib/vat-status';

describe('M32 จัดการเอกสารภาษีซื้อ: สถานะรวม + กำหนดใช้สิทธิ 6 เดือน', () => {
  it('กำหนดใช้สิทธิ = สิ้นเดือนที่ 6 นับจากเดือนของเอกสาร', () => {
    expect(claimDeadline('2026-10-24')).toBe('2027-04-30');
    expect(claimDeadline('2026-07-24')).toBe('2027-01-31');
    expect(claimDeadline('2026-02-10')).toBe('2026-08-31');
  });
  it('ตัวกรองรอใช้สิทธิ์: เดือนนี้/เดือนหน้า/ภายใน 6 เดือน/หมดอายุ', () => {
    const today = '2026-11-01';
    expect(claimBucket('2026-05-10', today)).toBe('m0');   // สิ้นสุด 2026-11-30
    expect(claimBucket('2026-06-10', today)).toBe('m1');   // สิ้นสุด 2026-12-31
    expect(claimBucket('2026-10-24', today)).toBe('m6');
    expect(claimBucket('2026-04-30', today)).toBe('exp');  // สิ้นสุด 2026-10-31
  });
  it('สถานะรวม: ยื่นแล้ว > ไม่ใช้สิทธิ > รอใบกำกับ > ภ.พ.36 > รอใบเสร็จ > รับใบกำกับ', () => {
    expect(vatKey({ st: 'received', filed: true, stage: '' })).toBe('filed');
    expect(vatKey({ st: 'waived', filed: false, stage: '' })).toBe('waived');
    expect(vatKey({ st: 'wait', filed: false, stage: '' })).toBe('wait');
    expect(vatKey({ st: 'received', filed: false, stage: 'pp36' })).toBe('pp36');
    expect(vatKey({ st: 'received', filed: false, stage: 'f36' })).toBe('pp36');
    expect(vatKey({ st: 'received', filed: false, stage: 'rdwait' })).toBe('rdwait');
    expect(vatKey({ st: 'received', filed: false, stage: 'rddone' })).toBe('received');
  });
});
