import { REPORT_PERIODS } from './period';
export type StGroup = { label: string; options: [string, string][] };
/** ช่วงเวลาที่รองรับในรายงาน (ค่าอื่น → เดือนปัจจุบัน) */
export const reportPeriod = (p?: string) => (REPORT_PERIODS.some(x => x[0] === p) ? p! : 'month');
/** ตัวกรองสถานะเป็นกลุ่ม: ค่าที่เลือก (st) → รายการสถานะจริงในฐานข้อมูล · ว่าง = ทั้งหมด */
export function pickStatuses(raw: string | string[] | undefined, buckets: Record<string, string[]>): { sel: string[]; list: string[] } {
  const sel = ([] as string[]).concat(raw ?? []).filter(s => s in buckets);
  return { sel, list: sel.flatMap(s => buckets[s]) };
}
export const pgArr = (a: string[]) => `{${a.join(',')}}`;
