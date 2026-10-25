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

// กลุ่มสถานะของรายงาน → สถานะจริง (ใช้ทั้งหน้ารายงานและไฟล์ Excel)
export const SALES_BUCKETS: Record<string, string[]> = { wait: ['awaiting_payment', 'pending_collect'], done: ['collected', 'paid'], rcpt: ['receipt_opened'], split: ['split_paid'],
  ok: ['approved', 'active'], cancelled: ['cancelled'] };
export const PURCHASE_BUCKETS: Record<string, string[]> = { pend: ['pending', 'unpaid'], appr: ['approved'], paid: ['paid'], cancelled: ['rejected', 'cancelled'] };
/** ช่วงเวลาที่แสดงบนหัวไฟล์ Excel แบบ FA: เดือนเต็ม → "ตุลาคม 2026" นอกนั้น "dd/mm/yyyy - dd/mm/yyyy" */
const MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
/** งวดภาษีบนหัวไฟล์ภาษี: เดือนเต็ม → "เดือน ตุลาคม ปี 2026" นอกนั้น "dd/mm/yyyy - dd/mm/yyyy" */
export function taxPeriodLabel(r: [string, string] | null): string {
  const l = periodLabel(r), m = MONTHS.findIndex(x => l.startsWith(x + ' '));
  return m >= 0 ? `เดือน ${MONTHS[m]} ปี ${l.slice(-4)}` : l;
}
export function periodLabel(r: [string, string] | null): string {
  if (!r) return 'ทั้งหมด';
  const [a, b] = r, last = new Date(Date.UTC(+a.slice(0, 4), +a.slice(5, 7), 0)).getUTCDate();
  if (a.slice(0, 7) === b.slice(0, 7) && a.slice(8) === '01' && +b.slice(8) === last) return `${MONTHS[+a.slice(5, 7) - 1]} ${a.slice(0, 4)}`;
  const f = (x: string) => `${x.slice(8)}/${x.slice(5, 7)}/${x.slice(0, 4)}`;
  return `${f(a)} - ${f(b)}`;
}
