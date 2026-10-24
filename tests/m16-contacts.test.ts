import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';

const dir = new URL('../supabase/migrations/', import.meta.url);
let db: PGlite;
const save = (p: object, id: string | null = null) => db.query<any>('select contact_save($1,$2::jsonb) id', [id, JSON.stringify({ is_customer: true, ...p })]);
const err = async (p: Promise<unknown>) => { try { await p; return ''; } catch (e) { return (e as Error).message; } };
beforeAll(async () => {
  db = new PGlite();
  for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(new URL(f, dir), 'utf8'));
});

describe('M16 สมุดรายชื่อ', () => {
  it('สร้าง/แก้ไขรายชื่อครบฟิลด์', async () => {
    const id = (await save({ business_name: 'บริษัท ก จำกัด', tax_id: '0105551234567', is_vendor: true, branch_code: '00001', branch_name: 'สาขา 1',
      person_email: 'a@b.co', credit_days: '30', bank_account_type: 'savings', contact_code: 'C001' })).rows[0].id;
    const r = (await db.query<any>('select * from contacts where id=$1', [id])).rows[0];
    expect([r.is_customer, r.is_vendor, r.credit_days, r.branch_code]).toEqual([true, true, 30, '00001']);
    await save({ business_name: 'บริษัท ก จำกัด (แก้)', is_customer: false, is_vendor: true, contact_code: 'C001' }, id);
    expect((await db.query<any>('select business_name, is_customer from contacts where id=$1', [id])).rows[0]).toEqual({ business_name: 'บริษัท ก จำกัด (แก้)', is_customer: false });
  });
  it('ตรวจกติกา: ประเภท ชื่อ ภาษี สาขา อีเมล รหัสซ้ำ', async () => {
    expect(await err(save({ business_name: 'x', is_customer: false }))).toContain('ประเภทอย่างน้อย');
    expect(await err(save({ business_name: ' ' }))).toContain('ชื่อธุรกิจ');
    expect(await err(save({ business_name: 'x', tax_id: '123' }))).toContain('10 หรือ 13');
    expect(await err(save({ business_name: 'x', branch_code: '12' }))).toContain('5 หลัก');
    expect(await err(save({ business_name: 'x', person_email: 'ผิด' }))).toContain('อีเมล');
    expect(await err(save({ business_name: 'y', contact_code: 'C001' }))).toContain('ซ้ำ');
    expect(await err(save({ business_name: 'ต่างชาติ', tax_id: 'US-123', is_foreign: true }))).toBe('');
  });
});
