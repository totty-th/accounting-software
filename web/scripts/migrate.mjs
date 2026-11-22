// apply migration ที่ยังไม่เคยรันลงฐานจริง (DATABASE_URL) — รันตอนเปิดคอนเทนเนอร์ทุกครั้ง
// · ตาราง app_schema_migrations เก็บชื่อไฟล์ที่รันแล้ว
// · ครั้งแรกบนฐานที่มีข้อมูลอยู่แล้ว (ย้ายมาจาก Supabase): บันทึกไฟล์ที่มีทั้งหมดว่ารันแล้ว (baseline) โดยไม่รันซ้ำ
// · ฐานว่าง: ข้ามไป ให้ lib/db.ts ติดตั้ง + ใส่ข้อมูลตัวอย่างเอง แล้วรอบถัดไปจะ baseline
// · แต่ละไฟล์รันในธุรกรรมเดียว ถ้าล้มให้ออกด้วย error (คอนเทนเนอร์ไม่เปิดเว็บ)
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

if (!process.env.DATABASE_URL) { console.log('[migrate] ไม่มี DATABASE_URL ข้าม'); process.exit(0); }
const dir = path.join(process.cwd(), 'migrations');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
try {
  await c.query('select pg_advisory_lock(727002)');
  if (!(await c.query(`select to_regclass('public.accounts') t`)).rows[0].t) { console.log('[migrate] ฐานว่าง ให้แอปติดตั้งเอง'); process.exit(0); }
  const fresh = !(await c.query(`select to_regclass('public.app_schema_migrations') t`)).rows[0].t;
  await c.query(`create table if not exists app_schema_migrations (name text primary key, applied_at timestamptz not null default now(), baseline boolean not null default false)`);
  if (fresh) {
    for (const f of files) await c.query(`insert into app_schema_migrations(name, baseline) values ($1, true) on conflict do nothing`, [f]);
    console.log(`[migrate] baseline ${files.length} ไฟล์ (ถึง ${files.at(-1)})`);
  }
  const done = new Set((await c.query('select name from app_schema_migrations')).rows.map(r => r.name));
  for (const f of files.filter(f => !done.has(f))) {
    console.log(`[migrate] apply ${f}`);
    await c.query('begin');
    try {
      await c.query(fs.readFileSync(path.join(dir, f), 'utf8'));
      await c.query('insert into app_schema_migrations(name) values ($1)', [f]);
      await c.query('commit');
    } catch (e) { await c.query('rollback'); console.error(`[migrate] ล้มที่ ${f}: ${e.message}`); process.exit(1); }
  }
  console.log('[migrate] ok');
} finally { await c.end().catch(() => {}); }
