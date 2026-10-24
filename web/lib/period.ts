// ตัวเลือก "ช่วงเวลา" ของหน้ารายการ/รายงานขาย (ลำดับตามต้นแบบ แต่ไม่มี "ปีงบประมาณ" เพราะยังไม่ได้ตั้งรอบบัญชี)
export const PERIODS: [string, string][] = [
  ['all', 'แสดงทั้งหมด'], ['month', 'เดือนปัจจุบัน'], ['lastmonth', 'เดือนก่อน'], ['year', 'ปีปัจจุบัน'], ['lastyear', 'ปีก่อน'], ['custom', 'เลือกช่วงวันที่'],
];
const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
/** คืน [จากวันที่, ถึงวันที่] (รวมสองวัน) หรือ null = ไม่จำกัด */
export function periodRange(period: string | undefined, todayIso: string, from?: string, to?: string): [string, string] | null {
  const y = Number(todayIso.slice(0, 4)), m = Number(todayIso.slice(5, 7));
  switch (period) {
    case 'month': return [iso(y, m, 1), iso(y, m, lastDay(y, m))];
    case 'lastmonth': { const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1; return [iso(py, pm, 1), iso(py, pm, lastDay(py, pm))]; }
    case 'year': return [iso(y, 1, 1), iso(y, 12, 31)];
    case 'lastyear': return [iso(y - 1, 1, 1), iso(y - 1, 12, 31)];
    case 'custom': return /^\d{4}-\d{2}-\d{2}$/.test(from ?? '') && /^\d{4}-\d{2}-\d{2}$/.test(to ?? '') ? [from!, to!] : null;
    default: return null;
  }
}
