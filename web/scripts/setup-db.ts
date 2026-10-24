// ติดตั้งฐานข้อมูลจริงครั้งแรก: รัน migration ทั้งหมด + ข้อมูลตัวอย่าง (ใช้ครั้งเดียวกับฐานที่ว่างเปล่า)
//   DATABASE_URL=postgres://... npx tsx scripts/setup-db.ts [--no-seed]
import fs from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import { seed } from '../lib/seed';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('ต้องตั้ง DATABASE_URL');
const c = new Client({ connectionString: url });
await c.connect();
const has = await c.query(`select to_regclass('public.accounts') as t`);
if (has.rows[0].t) throw new Error('ฐานนี้มีตารางบัญชีอยู่แล้ว ไม่รันซ้ำ');
const dir = path.join(process.cwd(), '..', 'supabase', 'migrations');
for (const f of fs.readdirSync(dir).sort()) { await c.query(fs.readFileSync(path.join(dir, f), 'utf8')); console.log('ok', f); }
if (!process.argv.includes('--no-seed')) await seed({ q: async (s, p) => (await c.query(s, p as any[])).rows });
await c.end(); console.log('เสร็จ');
