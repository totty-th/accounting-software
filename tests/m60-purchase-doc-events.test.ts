import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { COA } from '../web/lib/seed';

// M60 ประวัติเอกสารซื้อ (PO/RI/EXP): สร้าง · แก้ยอด/วันที่ · เปลี่ยนสถานะ · ผู้ทำ · ประวัติแก้/ลบไม่ได้
const dir = new URL('../supabase/migrations/', import.meta.url);
let db: PGlite; let sup = '', P = '', uid = '';
const J = JSON.stringify;
const one = async (q: string, a: unknown[] = []) => (await db.query<any>(q, a)).rows[0];
const ev = async (t: string, id: string) => (await db.query<any>(`select event, detail, actor_id from purchase_doc_events where doc_type=$1 and doc_id=$2 order by id`, [t, id])).rows;

beforeAll(async () => {
  db = new PGlite();
  for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(new URL(f, dir), 'utf8'));
  for (const [c, n, t] of COA) await db.query('insert into accounts(code,name,type) values ($1,$2,$3) on conflict (code) do update set name=excluded.name,type=excluded.type', [c, n, t]);
  sup = (await one(`insert into contacts(business_name,tax_id,credit_days) values ('ผู้ขาย ข','0105500000002',30) returning id`)).id;
  P = (await one(`insert into products(code,name,kind,sale_price,purchase_price,base_unit) values ('A','ตะแกรง','goods_stock',1000,600,'แผ่น') returning id`)).id;
  uid = (await one(`select id from app_users order by username limit 1`))?.id ?? (await one(`insert into app_users(username,display_name,role) values ('acc','นักบัญชี','accountant') returning id`)).id;
});

describe('M60 ประวัติเอกสารซื้อ', () => {
  it('RI: สร้าง → แก้ไข → อนุมัติ → จ่าย → รีเซ็ต · บันทึกผู้ทำจาก session', async () => {
    await db.query(`select set_config('app.user_id',$1,false)`, [uid]);
    const r = (await one('select save_goods_receipt($1::jsonb,$2::jsonb) id', [J({ date: '2026-10-02', contact: sup, credit_days: 30 }), J([{ product_id: P, qty: 10, unit_price: 600 }])])).id;
    expect((await ev('RI', r)).map(e => e.event)).toEqual(['created']);       // อัปเดตยอดในธุรกรรมเดียวกับที่สร้าง ไม่นับเป็นการแก้ไข
    await db.query('select update_goods_receipt($1,$2::jsonb,$3::jsonb)', [r, J({ date: '2026-10-03' }), J([{ product_id: P, qty: 8, unit_price: 600 }])]);
    await db.query('select approve_goods_receipt($1)', [r]);
    await db.query(`select pay_goods_receipt($1,'2026-10-20'::date)`, [r]);
    const e = await ev('RI', r);
    console.log(e.map(x => `${x.event}: ${x.detail}`).join('\n'));
    expect(e[0]).toMatchObject({ event: 'created', actor_id: uid });
    expect(e.some(x => x.event === 'edit' && /ยอดรวม 6,420.00 → 5,136.00/.test(x.detail) && /วันที่ 02\/10\/2026 → 03\/10\/2026/.test(x.detail))).toBe(true);
    expect(e.filter(x => x.event === 'status').map(x => x.detail)).toEqual(['unpaid>approved', 'approved>paid']);
    expect(e.every(x => x.actor_id === uid)).toBe(true);
  });
  it('EXP และ PO มีประวัติสร้าง/เปลี่ยนสถานะ', async () => {
    const x = (await one('select save_expense($1::jsonb,$2::jsonb) id', [J({ date: '2026-10-15', contact: sup }), J([{ description: 'ค่าเช่า', account: '53102', qty: 1, unit_price: 1000 }])])).id;
    await db.query(`select pay_expense($1,'2026-10-15'::date)`, [x]);
    expect((await ev('EXP', x)).map(e => e.event)).toEqual(['created', 'status']);
    const po = (await one('select save_purchase_order(null,$1::jsonb,$2::jsonb) id', [J({ date: '2026-10-01', contact: sup, credit_days: 30 }), J([{ product_id: P, qty: 5, unit_price: 600 }])])).id;
    await db.query('select approve_purchase_order($1)', [po]);
    expect((await ev('PO', po)).map(e => e.detail)).toEqual(['pending', 'pending>approved']);
  });
  it('ประวัติแก้ไขหรือลบไม่ได้', async () => {
    const msg = (p: Promise<unknown>) => p.then(() => '').catch((e: Error) => e.message);
    expect(await msg(db.query(`update purchase_doc_events set detail='x'`))).toContain('แก้ไขหรือลบไม่ได้');
    expect(await msg(db.query(`delete from purchase_doc_events`))).toContain('แก้ไขหรือลบไม่ได้');
  });
});
