// รอบระยะเวลารายงานแบบ FA: เลือกเป็น "ปีงบประมาณ" (ปีปฏิทิน — ตั้งค่างวดบัญชีสิ้นสุดธันวาคม) · ตัวเลือกปีมาจากวันที่ใบสำคัญแรกถึงปีปัจจุบัน
export async function fiscalYears(db: { q: <T = any>(sql: string) => Promise<T[]> }, todayIso: string): Promise<number[]> {
  const [r] = await db.q<any>('select extract(year from min(voucher_date))::int y from journal_vouchers');
  const cur = Number(todayIso.slice(0, 4)), first = Math.min(r?.y ?? cur, cur);
  return Array.from({ length: cur - first + 1 }, (_, i) => cur - i);
}
export const yearOf = (v: string | undefined, years: number[]) => (years.includes(Number(v)) ? Number(v) : years[0]);
export const thYear = (y: number) => String(y);
