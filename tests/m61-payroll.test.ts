import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { COA } from '../web/lib/seed';

// M61 โมดูลเงินเดือน ช่วง 1 — ตัวเลขเทียบกับที่ทดลองบน FA (docs/rea-payroll.md)
const dir = new URL('../supabase/migrations/', import.meta.url);
let db: PGlite;
const J = JSON.stringify;
const one = async (q: string, a: unknown[] = []) => (await db.query<any>(q, a)).rows[0];
const err = async (p: Promise<unknown>) => { try { await p; return ''; } catch (e) { return (e as Error).message; } };
const lines = async (v: string) => (await db.query<any>(`select a.code, l.debit::float8 d, l.credit::float8 c from journal_lines l join accounts a on a.id=l.account_id
  where l.voucher_id=$1 order by l.line_no`, [v])).rows.map(r => [r.code, r.d, r.c]);
const gl = async (code: string) => +(await one(`select coalesce(sum(l.debit-l.credit),0) b from journal_lines l join accounts a on a.id=l.account_id where a.code=$1`, [code])).b;
let e1 = '', e2 = '', bank = '';
const EMP = (x: object) => J({ code: 'EMP001', first_name: 'ทดสอบ', last_name: 'เงินเดือนสูง', national_id: '1101700203450', hire_date: '2026-01-01',
  pay_type: 'monthly', salary: 80000, pay_method: 'cash', ...x });

beforeAll(async () => {
  db = new PGlite();
  for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(new URL(f, dir), 'utf8'));
  for (const [c, n, t] of COA) await db.query('insert into accounts(code,name,type) values ($1,$2,$3) on conflict (code) do update set name=excluded.name,type=excluded.type', [c, n, t]);
  bank = (await one(`select bank_account_create('กสิกรไทย','748-2-31004-9','บจก. ทดสอบ') id`)).id;
});

describe('M61 เงินเดือน', () => {
  it('ปิดโมดูลอยู่ = ใช้งานไม่ได้ (ไม่บังคับใช้)', async () => {
    expect(await err(db.query(`select save_employee(null,$1::jsonb)`, [EMP({})]))).toContain('ยังไม่ได้เปิดใช้โมดูลเงินเดือน');
  });
  it('ตั้งค่า: ประกันสังคมขึ้นสิทธิ์ต้องมีเลขนายจ้าง', async () => {
    expect(await err(db.query(`select save_payroll_settings($1::jsonb)`, [J({ enabled: true, sso_enabled: true })]))).toContain('เลขที่บัญชีนายจ้าง');
    await db.query(`select save_payroll_settings($1::jsonb)`, [J({ enabled: true, sso_enabled: true, sso_employer_no: '1000000001', sso_branch: '000000', bank_account_id: bank, wcf_rate: 0.2 })]);
  });
  it('พนักงาน: ตรวจเลขบัตร · ภาษีอัตโนมัติ 80,000 = 6,075/เดือน ประกันสังคม 875 (ตรงกับ FA)', async () => {
    expect(await err(db.query(`select save_employee(null,$1::jsonb)`, [EMP({ national_id: '1101700203451' })]))).toContain('เลขบัตรประชาชนไม่ถูกต้อง');
    e1 = (await one(`select save_employee(null,$1::jsonb) id`, [EMP({})])).id;
    const b = (await one(`select payroll_tax_breakdown(80000) b`)).b;
    expect([+b.sso_month, +b.expense, +b.sso, +b.net, +b.tax_year, +b.tax_month]).toEqual([875, 100000, 10500, 789500, 72900, 6075]);
    expect(await err(db.query(`select save_employee(null,$1::jsonb)`, [EMP({ code: 'EMP002', pay_method: 'transfer' })]))).toContain('ธนาคาร');
    e2 = (await one(`select save_employee(null,$1::jsonb) id`, [EMP({ code: 'EMP002', first_name: 'ทดสอบ', last_name: 'รายวัน', national_id: '1101700203468',
      pay_type: 'daily', salary: 500, pay_method: 'transfer', bank_name: 'กสิกรไทย', bank_account_no: '1111111111' })])).id;
  });
  it('รายการเงินเดือน: บันทึก = JV ค้างจ่าย (ตาม FA สุทธิ) · จ่ายเงินสด = JV จ่าย', async () => {
    const r = (await one(`select save_payroll_run(null,$1::jsonb,$2::jsonb) id`, [J({ pay_type: 'monthly', pay_method: 'cash', period_from: '2026-11-01', period_to: '2026-11-30', pay_date: '2026-11-16' }),
      J([{ employee_id: e1 }])])).id;
    const l = await one(`select * from payroll_lines where run_id=$1`, [r]);
    expect([+l.base, +l.sso_employee, +l.wht_401, +l.net]).toEqual([80000, 875, 6075, 73050]);
    const run = await one(`select * from payroll_runs where id=$1`, [r]);
    expect(await lines(run.accrual_voucher_id)).toEqual([['53011.01', 80000, 0], ['53012.01', 875, 0], ['21952.01', 0, 1750], ['27121', 0, 6075], ['21951.01', 0, 73050]]);
    // แก้ก่อนจ่าย: OT 5,000 + หักขาด 1,000 → ภาษีเงินได้ไม่ประจำ 4,000 เพิ่ม 800 (6,075 → 6,875) · JV เดิมกลับรายการแล้วลงใหม่
    await db.query(`select save_payroll_run($1,$2::jsonb,$3::jsonb)`, [r, J({}), J([{ employee_id: e1, ot: 5000, absence: 1000 }])]);
    const r2 = await one(`select * from payroll_runs where id=$1`, [r]);
    expect((await one(`select * from payroll_lines where run_id=$1`, [r])).net).toBe('76250.00');
    expect(await lines(r2.accrual_voucher_id)).toEqual([['53011.01', 80000, 0], ['53011.02', 5000, 0], ['53012.01', 875, 0], ['21952.01', 0, 1750],
      ['27121', 0, 6875], ['49920', 0, 1000], ['21951.01', 0, 76250]]);
    expect(await gl('21951.01')).toBe(-76250);
    expect(await err(db.query(`select pay_payroll_run($1,'2026-11-16',15)`, [r]))).toContain('ไม่มีค่าธรรมเนียม');
    const pv = (await one(`select pay_payroll_run($1,'2026-11-16') v`, [r])).v;
    expect(await lines(pv)).toEqual([['21951.01', 76250, 0], ['11112', 0, 76250]]);
    expect(await gl('21951.01')).toBe(0);
    expect(await err(db.query(`select save_payroll_run($1,'{}'::jsonb,$2::jsonb)`, [r, J([{ employee_id: e1 }])]))).toContain('รีเซ็ตการชำระก่อน');
    expect(await err(db.query(`select cancel_payroll_run($1)`, [r]))).toContain('รีเซ็ตการชำระก่อน');
    await db.query(`select reset_payroll_payment($1)`, [r]);
    expect(await gl('11112')).toBe(0); expect(await gl('21951.01')).toBe(-76250);
  });
  it('ค่าจ้างรายวัน 20 วัน × 500 · ประกันสังคม 500 · ไม่มีภาษีอัตโนมัติ · จ่ายโอน+ค่าธรรมเนียม 15 → ยกเลิกได้หลังรีเซ็ต', async () => {
    const r = (await one(`select save_payroll_run(null,$1::jsonb,$2::jsonb) id`, [J({ pay_type: 'daily', pay_method: 'transfer', period_from: '2026-11-01', period_to: '2026-11-30', pay_date: '2026-11-16' }),
      J([{ employee_id: e2, days: 20 }])])).id;
    const l = await one(`select * from payroll_lines where run_id=$1`, [r]);
    expect([+l.base, +l.sso_employee, +l.wht_401, +l.net]).toEqual([10000, 500, 0, 9500]);
    expect(await err(db.query(`select save_payroll_run(null,$1::jsonb,$2::jsonb)`, [J({ pay_type: 'daily', pay_method: 'transfer', period_from: '2026-11-01', period_to: '2026-11-30' }),
      J([{ employee_id: e1 }])]))).toContain('ไม่ใช่พนักงานรายวัน');
    const pv = (await one(`select pay_payroll_run($1,'2026-11-16',15) v`, [r])).v;
    expect(await lines(pv)).toEqual([['21951.01', 9500, 0], ['53211', 15, 0], ['11122.01', 0, 9515]]);
    await db.query(`select reset_payroll_payment($1)`, [r]);
    await db.query(`select cancel_payroll_run($1)`, [r]);
    expect(await gl('11122.01')).toBe(0); expect(await gl('53211')).toBe(0);
    expect(await gl('21951.01')).toBe(-76250);     // เหลือเฉพาะของรายการรายเดือน
    const t = await one(`select coalesce(sum(debit),0)::float8 d, coalesce(sum(credit),0)::float8 c from journal_lines`);
    expect(t.d).toBe(t.c);
  });
  it('ภาษีขั้นบันไดสูง/ต่ำ และเพดาน/ขั้นต่ำประกันสังคม', async () => {
    expect(+(await one(`select payroll_sso(10000) v`)).v).toBe(500);
    expect(+(await one(`select payroll_sso(1000) v`)).v).toBe(83);       // ขั้นต่ำ 1,650 × 5% = 82.5 → 83
    expect(+(await one(`select payroll_wht_monthly(15000, 750) v`)).v).toBe(0);
    expect(+(await one(`select pit_annual(6000000) v`)).v).toBe(1615000);   // 7,500+20,000+37,500+50,000+250,000+900,000+350,000
  });
  it('ภาษีเงินได้ไม่ประจำ (OT/คอมมิชชั่น) คิดส่วนต่างภาษีทั้งปี · ภ.ง.ด.1 ดึงเฉพาะที่จ่ายแล้วตามวันที่ชำระ', async () => {
    expect(+(await one(`select payroll_wht_extra(80000, 875, 4000) v`)).v).toBe(800);
    expect(+(await one(`select payroll_wht_extra(80000, 875, -1000) v`)).v).toBe(-200);
    expect(+(await one(`select payroll_wht_extra(20000, 750, 10000) v`)).v).toBe(0);
    const r = (await one(`select id from payroll_runs where pay_type='monthly' and status='pending'`)).id;
    expect((await db.query(`select * from pnd1_lines('2026-11-01','2026-11-30')`)).rows).toHaveLength(0);
    await db.query(`select pay_payroll_run($1,'2026-11-30')`, [r]);
    const p = (await db.query<any>(`select * from pnd1_lines('2026-11-01','2026-11-30')`)).rows;
    expect(p.map(x => [x.code, x.national_id, +x.income, +x.wht_401, +x.wht_402, String(x.paid_date).slice(0, 4)]))
      .toEqual([['EMP001', '1101700203450', 84000, 6875, 0, String(p[0].paid_date).slice(0, 4)]]);
    expect((await db.query(`select * from pnd1_lines('2026-12-01','2026-12-31')`)).rows).toHaveLength(0);
  });
});
