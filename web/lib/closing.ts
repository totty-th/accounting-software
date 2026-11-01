// รอบปิดบัญชีแบบ FA (REA 1-11-2026): เดือนปัจจุบัน/เดือนก่อน/เลือกเดือน/ปีปัจจุบัน/ปีก่อน/ช่วงวันที่ · ค่าเริ่มต้น = เดือนปัจจุบัน · ปิดได้หลายครั้งต่อปี
const pad = (n: number) => String(n).padStart(2, '0');
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const isDate = (s?: string) => /^\d{4}-\d{2}-\d{2}$/.test(s ?? '');
export const CLOSING_PRESETS: [string, string][] = [['cur', 'เดือนนี้'], ['prev', 'เดือนก่อน'], ['pick', 'เลือกเดือน'], ['ycur', 'ปีนี้'], ['yprev', 'ปีก่อน'], ['range', 'ช่วงวันที่']];
export const monthRange = (y: number, m: number) => ({ from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(lastDay(y, m))}` });
export const yearRange = (y: number) => ({ from: `${y}-01-01`, to: `${y}-12-31` });
/** คำนวณรอบจากปุ่มลัด (m) · pick/range ใช้ค่าที่ผู้ใช้เลือก (month=YYYY-MM, from/to) */
export function closingRange(q: { m?: string; month?: string; from?: string; to?: string }, today: string): { m: string; from: string; to: string } {
  const ty = Number(today.slice(0, 4)), tm = Number(today.slice(5, 7));
  const m = CLOSING_PRESETS.some(p => p[0] === q.m) ? q.m! : (isDate(q.from) && isDate(q.to) ? 'range' : 'cur');
  if (m === 'ycur') return { m, ...yearRange(ty) };
  if (m === 'yprev') return { m, ...yearRange(ty - 1) };
  if (m === 'prev') return { m, ...(tm === 1 ? monthRange(ty - 1, 12) : monthRange(ty, tm - 1)) };
  if (m === 'pick') { const ok = /^\d{4}-\d{2}$/.test(q.month ?? ''); return { m, ...(ok ? monthRange(Number(q.month!.slice(0, 4)), Number(q.month!.slice(5, 7))) : monthRange(ty, tm)) }; }
  if (m === 'range') return { m, from: isDate(q.from) ? q.from! : `${ty}-${pad(tm)}-01`, to: isDate(q.to) ? q.to! : today };
  return { m: 'cur', ...monthRange(ty, tm) };
}
export const STATUS_TH: Record<string, string> = { pending: 'รอดำเนินการ', approved: 'อนุมัติแล้ว' };
