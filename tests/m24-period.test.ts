import { describe, it, expect } from 'vitest';
import { periodRange } from '../web/lib/period';

describe('M24 ช่วงเวลาย้อนหลัง', () => {
  it('3/6/12 เดือนนับจากวันนี้', () => {
    expect(periodRange('m3', '2026-10-25')).toEqual(['2026-07-25', '2026-10-25']);
    expect(periodRange('m6', '2026-10-25')).toEqual(['2026-04-25', '2026-10-25']);
    expect(periodRange('y1', '2026-10-25')).toEqual(['2025-10-25', '2026-10-25']);
  });
  it('วันที่ 31 ย้อนไปเดือนที่สั้นกว่า → สิ้นเดือน', () => {
    expect(periodRange('m3', '2026-05-31')).toEqual(['2026-02-28', '2026-05-31']);
    expect(periodRange('m3', '2026-01-15')).toEqual(['2025-10-15', '2026-01-15']);
  });
});
