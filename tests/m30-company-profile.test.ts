import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readdirSync, readFileSync } from 'fs';
import { matchShortcut, SHORTCUTS } from '../web/lib/shortcuts';

let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  for (const f of readdirSync('supabase/migrations').sort()) await db.exec(readFileSync(`supabase/migrations/${f}`, 'utf8'));
});
describe('ข้อมูลธุรกิจ (0067)', () => {
  it('บันทึกค่าเริ่มต้นและฟิลด์ใหม่', async () => {
    await db.query(`insert into company_profile(name,address,tax_id) values ('ทดสอบ','1','0105500000099')`);
    const r = (await db.query<any>('select * from company_profile')).rows[0];
    expect(r.business_type).toBe('company'); expect(r.vat_registered).toBe(true); expect(r.is_branch).toBe(false);
  });
  it('สาขาต้องมีรหัส 5 หลัก', async () => {
    await expect(db.query(`update company_profile set is_branch=true`)).rejects.toThrow();
    await db.query(`update company_profile set is_branch=true, branch_no='00001'`);
    await expect(db.query(`update company_profile set branch_no='1'`)).rejects.toThrow();
  });
});
describe('แป้นพิมพ์ลัด', () => {
  it('จับคู่ Alt+S / Shift+Alt+S ต่างกัน และไม่ชนกัน', () => {
    expect(matchShortcut({ altKey: true, shiftKey: false, code: 'KeyS' })?.id).toBe('save');
    expect(matchShortcut({ altKey: true, shiftKey: true, code: 'KeyS' })?.id).toBe('save-close');
    expect(matchShortcut({ altKey: false, shiftKey: false, code: 'KeyS' })).toBeUndefined();
    const ks = SHORTCUTS.map(s => `${s.shift}${s.key}`); expect(new Set(ks).size).toBe(ks.length);
  });
});

const q = async (s: string, p: any[] = []) => (await db.query<any>(s, p)).rows;
describe('งวดบัญชี (0070)', () => {
  it('ตั้งเดือนสิ้นงวด/วันก่อตั้งได้ และตรวจค่า', async () => {
    await q(`insert into company_profile(name,address,tax_id) values ('บ','ที่อยู่','1234567890123') on conflict (singleton) do nothing`);
    await q(`select save_fiscal_period(9, date '2020-01-15')`);
    const r = (await q(`select fiscal_end_month m, founded_on::text f from company_profile`))[0];
    expect(r).toMatchObject({ m: 9, f: '2020-01-15' });
    await expect(q(`select save_fiscal_period(13, null)`)).rejects.toThrow(/เดือน/);
    await expect(q(`select save_fiscal_period(12, date '2999-01-01')`)).rejects.toThrow(/อนาคต/);
  });
});
