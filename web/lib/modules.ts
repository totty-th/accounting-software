import { getDb } from './db';
/** โมดูลเสริมที่เปิดใช้ (ซ่อนเมนูเมื่อปิด) — ถ้าตารางยังไม่มี (ฐานเก่า) ถือว่าปิด */
export async function enabledModules(): Promise<string[]> {
  try {
    const r = await (await getDb()).q<{ enabled: boolean }>(`select enabled from payroll_settings limit 1`);
    return r[0]?.enabled ? ['payroll'] : [];
  } catch { return []; }
}
export const payrollEnabled = async () => (await enabledModules()).includes('payroll');
