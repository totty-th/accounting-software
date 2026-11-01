// รอบปิดบัญชีแบบ FA: เดือนปัจจุบัน/เดือนก่อน/ช่วงวันที่/ปี(เลือกปีใดก็ได้) · ปิดได้หลายครั้งต่อปี
const pad = (n: number) => String(n).padStart(2, '0');
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
export const CLOSING_MODES: [string, string][] = [['month', 'เดือน'], ['range', 'เลือกช่วงวันที่'], ['year', 'ปี']];
export function closingRange(q: { mode?: string; month?: string; year?: string; from?: string; to?: string }, today: string): { mode: string; from: string; to: string } {
  const mode = CLOSING_MODES.some(m => m[0] === q.mode) ? q.mode! : 'month';
  const ty = Number(today.slice(0, 4)), tm = Number(today.slice(5, 7));
  if (mode === 'year') { const y = /^\d{4}$/.test(q.year ?? '') ? Number(q.year) : ty; return { mode, from: `${y}-01-01`, to: `${y}-12-31` }; }
  if (mode === 'range') { const ok = (s?: string) => /^\d{4}-\d{2}-\d{2}$/.test(s ?? ''); return { mode, from: ok(q.from) ? q.from! : `${ty}-${pad(tm)}-01`, to: ok(q.to) ? q.to! : today }; }
  let y = ty, m = tm - 1; if (m < 1) { m = 12; y--; }               // ค่าตั้งต้น = เดือนก่อน (เดือนที่จบแล้ว)
  if (/^\d{4}-\d{2}$/.test(q.month ?? '')) { y = Number(q.month!.slice(0, 4)); m = Number(q.month!.slice(5, 7)); }
  return { mode, from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(lastDay(y, m))}` };
}
export const STATUS_TH: Record<string, string> = { pending: 'รอดำเนินการ', approved: 'อนุมัติแล้ว' };
