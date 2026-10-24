import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';

const dir = new URL('../supabase/migrations/', import.meta.url);
const sql = readdirSync(dir).sort().map(f => readFileSync(new URL(f, dir), 'utf8')).join('\n');
let db: PGlite;
const err = async (p: Promise<unknown>) => { try { await p; return ''; } catch (e) { return (e as Error).message; } };
const one = async <T = any>(q: string, p: unknown[] = []) => (await db.query<T>(q, p)).rows[0];

beforeAll(async () => { db = new PGlite(); await db.exec(sql); });
beforeEach(async () => {
  await db.exec(`truncate sales_doc_lines, sales_docs, app_users, journal_lines, journal_vouchers, doc_sequences, accounts, contacts cascade`);
});
const user = async (u: string, role: string) => (await one<{ id: string }>(`select app_user_create($1,$2,$3) as id`, [u, 'ชื่อ ' + u, role])).id;

describe('M14 ผู้ใช้', () => {
  it('สร้างผู้ใช้: ชื่อผู้ใช้เป็นตัวพิมพ์เล็ก และซ้ำไม่ได้ (แม้ต่างตัวพิมพ์)', async () => {
    await user('Somchai', 'sales');
    expect((await one(`select username from app_users`)).username).toBe('somchai');
    expect(await err(db.query(`select app_user_create('SOMCHAI','x','owner')`))).toContain('มีอยู่แล้ว');
  });
  it('ปฏิเสธชื่อผู้ใช้ที่ไม่ถูกรูปแบบ และตำแหน่งที่ไม่รู้จัก', async () => {
    expect(await err(db.query(`select app_user_create('ab','x','owner')`))).toContain('ชื่อผู้ใช้');
    expect(await err(db.query(`select app_user_create('a b c','x','owner')`))).toContain('ชื่อผู้ใช้');
    expect(await err(db.query(`select app_user_create('abcd','x','hacker')`))).toContain('ตำแหน่ง');
  });
  it('ต้องเหลือผู้ดูแลระบบ (super_admin/it) ที่ใช้งานอยู่อย่างน้อย 1 คน', async () => {
    const a = await user('admin', 'super_admin'); const t = await user('itguy', 'it');
    await db.query(`update app_users set is_active=false where id=$1`, [a]);          // ยังมี IT
    expect(await err(db.query(`update app_users set is_active=false where id=$1`, [t]))).toContain('ผู้ดูแลระบบ');
    expect(await err(db.query(`update app_users set role='owner' where id=$1`, [t]))).toContain('ผู้ดูแลระบบ');
    expect(await err(db.query(`delete from app_users where id=$1`, [t]))).toContain('ผู้ดูแลระบบ');
    await db.query(`update app_users set is_active=true where id=$1`, [a]);          // กลับมาเปิดได้
    await db.query(`update app_users set role='owner' where id=$1`, [t]);            // ตอนนี้มี admin อีกคน จึงเปลี่ยนได้
  });
});

describe('M14 ผู้สร้างเอกสารขาย', () => {
  const mk = async (uid: string | null) => {
    const c = (await one<{ id: string }>(`insert into contacts(business_name) values ('ลูกค้า') returning id`)).id;
    await db.query(`insert into accounts(code,name,type) values ('11311','ลูกหนี้','asset'),('41210','รายได้','revenue'),('27111','ภาษีขาย','liability') on conflict do nothing`);
    const lines = JSON.stringify([{ description: 'บริการ', kind: 'service', qty: 1, unit_price: 100 }]);
    const r = uid
      ? await one<{ id: string }>(`select create_sales_doc('QT','2026-10-24',$2,$3::jsonb) as id from (select set_config('app.user_id',$1,true)) s`, [uid, c, lines])
      : await one<{ id: string }>(`select create_sales_doc('QT','2026-10-24',$1,$2::jsonb) as id`, [c, lines]);
    return r.id;
  };
  it('บันทึกผู้สร้างจาก app.user_id ในคำสั่งเดียวกัน', async () => {
    const u = await user('sale1', 'sales');
    const id = await mk(u);
    expect((await one(`select created_by from sales_docs where id=$1`, [id])).created_by).toBe(u);
  });
  it('ไม่ตั้ง app.user_id = ไม่มีผู้สร้าง (null) และค่าไม่รั่วไปคำสั่งถัดไป', async () => {
    const u = await user('sale1', 'sales');
    await mk(u);
    const id2 = await mk(null);
    expect((await one(`select created_by from sales_docs where id=$1`, [id2])).created_by).toBeNull();
  });
});
