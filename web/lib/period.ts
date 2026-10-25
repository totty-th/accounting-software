// ตัวเลือก "ช่วงเวลา" ของหน้ารายการ/รายงานขาย (ลำดับตามต้นแบบ แต่ไม่มี "ปีงบประมาณ" เพราะยังไม่ได้ตั้งรอบบัญชี)
export const PERIODS: [string, string][] = [
  ['all', 'แสดงทั้งหมด'], ['month', 'เดือนปัจจุบัน'], ['lastmonth', 'เดือนก่อน'], ['m3', '3 เดือนที่แล้ว'], ['m6', '6 เดือนที่แล้ว'], ['y1', '1 ปีที่แล้ว'], ['year', 'ปีปัจจุบัน'], ['lastyear', 'ปีก่อน'], ['custom', 'เลือกช่วงวันที่'],
];
// ช่วงเวลาของหน้ารายงาน (ตาม FA: เดือนปัจจุบัน / เดือนก่อน / เลือกช่วงวันที่ / ปีปัจจุบัน / ปีก่อน)
export const REPORT_PERIODS: [string, string][] = [['month', 'เดือนปัจจุบัน'], ['lastmonth', 'เดือนก่อน'], ['custom', 'เลือกช่วงวันที่'], ['year', 'ปีปัจจุบัน'], ['lastyear', 'ปีก่อน']];
const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
/** คืน [จากวันที่, ถึงวันที่] (รวมสองวัน) หรือ null = ไม่จำกัด */
export function periodRange(period: string | undefined, todayIso: string, from?: string, to?: string): [string, string] | null {
  const y = Number(todayIso.slice(0, 4)), m = Number(todayIso.slice(5, 7));
  switch (period) {
    case 'month': return [iso(y, m, 1), iso(y, m, lastDay(y, m))];
    case 'lastmonth': { const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1; return [iso(py, pm, 1), iso(py, pm, lastDay(py, pm))]; }
    case 'm3': case 'm6': case 'y1': {                 // ย้อนหลังนับจากวันนี้ (วันเดียวกันของเดือนก่อนหน้า → วันนี้)
      const back = period === 'm3' ? 3 : period === 'm6' ? 6 : 12;
      const d = new Date(Date.UTC(y, m - 1 - back, Number(todayIso.slice(8, 10))));
      if (d.getUTCMonth() !== ((m - 1 - back) % 12 + 12) % 12) d.setUTCDate(0);   // 31 → สิ้นเดือนสั้นกว่า
      return [d.toISOString().slice(0, 10), todayIso];
    }
    case 'year': return [iso(y, 1, 1), iso(y, 12, 31)];
    case 'lastyear': return [iso(y - 1, 1, 1), iso(y - 1, 12, 31)];
    case 'custom': return /^\d{4}-\d{2}-\d{2}$/.test(from ?? '') && /^\d{4}-\d{2}-\d{2}$/.test(to ?? '') ? [from!, to!] : null;
    default: return null;
  }
}
