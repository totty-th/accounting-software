import { empName } from './payroll';
type Db = { q: <T = any>(sql: string, a?: unknown[]) => Promise<T[]> };
/** ช่วงวันที่ของเดือน "YYYY-MM" (ค่าเริ่มต้น = เดือนของวันนี้) */
export function monthRange(m: string | undefined, todayIso: string) {
  const ym = /^\d{4}-\d{2}$/.test(m ?? '') ? m! : todayIso.slice(0, 7);
  const [y, mo] = ym.split('-').map(Number);
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return { ym, from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, '0')}` };
}
export const TH_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
export const monthTh = (ym: string) => `${TH_MONTHS[Number(ym.slice(5, 7)) - 1]} ${Number(ym.slice(0, 4)) + 543}`;
/** กำหนดยื่น: กระดาษภายในวันที่ 7 · ออนไลน์ภายในวันที่ 15 ของเดือนถัดไป */
export const dueOf = (ym: string) => { const [y, m] = ym.split('-').map(Number); const n = m === 12 ? [y + 1, 1] : [y, m + 1];
  return (d: number) => `${String(d).padStart(2, '0')}/${String(n[1]).padStart(2, '0')}/${n[0] + 543}`; };

export async function pnd1Data(db: Db, from: string, to: string) {
  const rows = (await db.q<any>(`select *, paid_date::text pd from pnd1_lines($1, $2)`, [from, to])).map(r => ({
    code: r.code as string, tax_id: (r.national_id ?? '') as string, name: empName(r), title: r.title as string, first_name: r.first_name as string,
    last_name: r.last_name as string, address: (r.address ?? '') as string, date: r.pd as string,
    income: Number(r.income), wht401: Number(r.wht_401), wht402: Number(r.wht_402) }));
  const sum = (f: (r: typeof rows[number]) => number) => Math.round(rows.reduce((a, r) => a + f(r), 0) * 100) / 100;
  return { rows, n401: rows.length, income: sum(r => r.income), wht401: sum(r => r.wht401),
    n402: rows.filter(r => r.wht402 > 0).length, wht402: sum(r => r.wht402) };
}
