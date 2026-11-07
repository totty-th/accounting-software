import { describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { COA } from '../web/lib/seed';

const dir = new URL('../supabase/migrations/', import.meta.url);

describe('m51 นำเข้าบัญชีจากผังเดิม', () => {
  it('สร้างครบ ไม่ซ้ำ อยู่ใต้กลุ่มคุมที่ถูกชนิด', async () => {
    const db = new PGlite();
    for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(new URL(f, dir), 'utf8'));
    for (const [c, n, t] of COA) await db.query('insert into accounts(code,name,type) values ($1,$2,$3) on conflict (code) do update set name=excluded.name,type=excluded.type', [c, n, t]);
    const cnt = async () => +(await db.query<any>('select count(*) c from accounts')).rows[0].c;
    const before = await cnt();
    const sql = readFileSync('scripts/coa-old-import.sql', 'utf8').split('\n').filter(l => l.startsWith('select'));
    for (const l of sql) await db.query(l);
    expect(await cnt() - before).toBe(sql.length);
    const bad = (await db.query<any>(`select a.code from accounts a join accounts p on p.id=a.parent_id where a.code ~ '^[0-9]{4}\\.' and (not p.is_control or a.type <> p.type or a.is_control)`)).rows;
    expect(bad).toEqual([]);
    const r = (await db.query<any>(`select p.code pc from accounts a join accounts p on p.id=a.parent_id where a.code='5200.05'`)).rows[0];
    expect(r.pc).toBe('52030');
  });
});
