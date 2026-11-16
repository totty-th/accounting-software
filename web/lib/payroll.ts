// ตัวช่วยฝั่งหน้าจอของโมดูลเงินเดือน (สูตรเดียวกับฟังก์ชันในฐานข้อมูล payroll_sso / payroll_wht_monthly — ใช้แสดงตัวอย่างเท่านั้น ยอดจริงคำนวณที่ฐานข้อมูล)
export const PAY_TYPE: Record<string, string> = { monthly: 'พนักงานรายเดือน', daily: 'พนักงานรายวัน' };
export const RUN_TYPE: Record<string, string> = { monthly: 'เงินเดือน', daily: 'ค่าจ้างรายวัน' };
export const PAY_METHOD: Record<string, string> = { cash: 'เงินสด', transfer: 'โอนเงิน' };
export const EMP_STATUS: Record<string, [string, string]> = { probation: ['ทดลองงาน', 'orange'], active: ['พนักงานประจำ', 'green'], resigned: ['ลาออก', 'grey'] };
export const RUN_STATUS: Record<string, [string, string]> = { pending: ['รอดำเนินการ', 'orange'], paid: ['ชำระเงินแล้ว', 'green'], cancelled: ['ยกเลิก', 'red'] };
export const BANKS = ['กสิกรไทย', 'ไทยพาณิชย์', 'กรุงเทพ', 'กรุงไทย', 'ทหารไทยธนชาต', 'กรุงศรีอยุธยา', 'ออมสิน', 'ธ.ก.ส.', 'ยูโอบี', 'ซีไอเอ็มบี ไทย', 'แลนด์ แอนด์ เฮ้าส์', 'เกียรตินาคินภัทร', 'อาคารสงเคราะห์'];

const BRACKETS: [number, number, number][] = [[0, 150000, 0], [150000, 300000, .05], [300000, 500000, .10], [500000, 750000, .15],
  [750000, 1000000, .20], [1000000, 2000000, .25], [2000000, 5000000, .30], [5000000, Infinity, .35]];
const r2 = (n: number) => Math.round(n * 100) / 100;
export const pitAnnual = (net: number) => r2(BRACKETS.reduce((s, [lo, hi, r]) => s + (Math.min(Math.max(net, lo), hi) - lo) * r, 0));
export const ssoOf = (wage: number, min = 1650, cap = 17500, rate = 5) => (wage <= 0 ? 0 : Math.round(Math.min(Math.max(wage, min), cap) * rate / 100));
export function taxBreakdown(salary: number, sso: boolean) {
  const annual = salary * 12, s = sso ? ssoOf(salary) : 0, expense = Math.min(annual * 0.5, 100000);
  const net = Math.max(annual - expense - 60000 - s * 12, 0), year = pitAnnual(net);
  return { annual, expense, afterExpense: annual - expense, personal: 60000, ssoYear: s * 12, ssoMonth: s, net, year, month: r2(year / 12) };
}
export const thaiIdValid = (id: string) => /^\d{13}$/.test(id) &&
  (11 - [...id.slice(0, 12)].reduce((s, d, i) => s + Number(d) * (13 - i), 0) % 11) % 10 === Number(id[12]);
export const empName = (e: { title?: string | null; first_name: string; last_name: string }) => `${e.title ?? ''}${e.first_name} ${e.last_name}`;
