import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';

const dir = new URL('../supabase/migrations/', import.meta.url);
let db: PGlite, id: string;
const one = async (q: string, a: unknown[] = []) => (await db.query<any>(q, a)).rows[0];
const err = async (p: Promise<unknown>) => { try { await p; return ''; } catch (e) { return (e as Error).message; } };

beforeAll(async () => {
  db = new PGlite();
  for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(new URL(f, dir), 'utf8'));
  const c = await one(`insert into contacts(business_name) values ('ผู้ถูกหัก') returning id`);
  id = (await one(`select create_standalone_wht('2026-10-15', $1, 'PND53', $2::jsonb) id`, [c.id, JSON.stringify([{ income_type: 'ค่าบริการ', rate: 3, amount: 10000 }])])).id;
});

describe('WHT รีเซ็ต/ดำเนินการ (ตามต้นแบบ)', () => {
  it('ยกเลิก → รีเซ็ต → รอดำเนินการ → ดำเนินการแล้ว', async () => {
    await db.query('select cancel_wht_cert($1)', [id]);
    expect((await one('select status from wht_certs where id=$1', [id])).status).toBe('cancelled');
    await db.query('select reset_wht_cert($1)', [id]);
    expect((await one('select status from wht_certs where id=$1', [id])).status).toBe('pending');
    expect(await err(db.query('select reset_wht_cert($1)', [id]))).toContain('รอดำเนินการอยู่แล้ว');
    await db.query('select activate_wht_cert($1)', [id]);
    expect((await one('select status from wht_certs where id=$1', [id])).status).toBe('active');
    expect(await err(db.query('select activate_wht_cert($1)', [id]))).toContain('รอดำเนินการ');
  });
  it('ดำเนินการแล้ว → รีเซ็ตได้', async () => {
    await db.query('select reset_wht_cert($1)', [id]);
    expect((await one('select status from wht_certs where id=$1', [id])).status).toBe('pending');
  });
});
