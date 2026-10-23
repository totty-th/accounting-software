import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';

export type Row = Record<string, any>;
export interface Db { q<T = Row>(sql: string, params?: unknown[]): Promise<T[]>; }

const g = globalThis as unknown as { __db?: Promise<Db> };
export function getDb(): Promise<Db> { return (g.__db ??= init()); }

// มี DATABASE_URL → ต่อ Postgres/Supabase จริง (migration ลงด้วย Supabase CLI)
// ไม่มี → ใช้ PGlite เก็บในโฟลเดอร์ .data สำหรับทดลองในเครื่อง พร้อมข้อมูลตัวอย่าง
async function init(): Promise<Db> {
  if (process.env.DATABASE_URL) {
    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    return { q: async (s, p) => (await pool.query(s, p as any[])).rows };
  }
  // บน Vercel ระบบไฟล์เขียนได้เฉพาะ /tmp (เดโมเท่านั้น: ข้อมูลรีเซ็ตเมื่อ instance เริ่มใหม่)
  const dir = process.env.PGLITE_DIR ?? (process.env.VERCEL ? path.join(os.tmpdir(), 'pglite') : path.join(process.cwd(), '.data', 'pglite'));
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  const pg = new PGlite(dir);
  const db: Db = { q: async (s, p) => (await pg.query(s, p as any[])).rows as any };
  const has = await pg.query(`select to_regclass('public.accounts') as t`);
  if (!(has.rows[0] as Row).t) {
    const local = path.join(process.cwd(), 'migrations'); // สำเนาที่ npm run sync-migrations สร้างไว้ให้ deploy
    const mdir = fs.existsSync(local) ? local : path.join(process.cwd(), '..', 'supabase', 'migrations');
    for (const f of fs.readdirSync(mdir).sort()) await pg.exec(fs.readFileSync(path.join(mdir, f), 'utf8'));
    const { seed } = await import('./seed');
    await seed(db);
  }
  return db;
}

export const today = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
export const monthStart = () => today().slice(0, 8) + '01';
