import { describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';

// รายชื่อพนักงานขาย (เจ้าของระบบกำหนด 16-11-2026)
const dir = new URL('../supabase/migrations/', import.meta.url);
describe('รายชื่อพนักงานขาย', () => {
  it('seed 15 ชื่อตามที่เจ้าของกำหนด เรียงตามลำดับ', async () => {
    const db = new PGlite();
    for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(new URL(f, dir), 'utf8'));
    const r = (await db.query<any>('select name from salespeople where is_active order by sort_order')).rows.map(x => x.name);
    expect(r).toEqual(['จิม', 'ร่ม', 'เปี๊ยก', 'มล', 'เป้', 'เอก', 'นา', 'อุ๊', 'วาสนา', 'เมย์', 'นก', 'ปุ๋ย', 'วิโรจน์', 'จ้อย', 'โก้']);
  });
});
