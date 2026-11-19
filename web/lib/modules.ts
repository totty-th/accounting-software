import { getDb } from '@/lib/db';

/** โมดูลเสริมที่เปิดอยู่ · payroll เก็บใน payroll_settings (เดิม) · โมดูลอื่นเก็บใน app_modules */
export async function enabledModules(): Promise<string[]> {
  const db = await getDb(); const out: string[] = [];
  try { const r = await db.q<{ enabled: boolean }>(`select enabled from payroll_settings limit 1`); if (r[0]?.enabled) out.push('payroll'); } catch {}
  try { (await db.q<{ key: string }>(`select key from app_modules where enabled`)).forEach(r => out.push(r.key)); } catch {}
  return out;
}
export const payrollEnabled = async () => (await enabledModules()).includes('payroll');
export const scanEnabled = async () => (await enabledModules()).includes('scan');
