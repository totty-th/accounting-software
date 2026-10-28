import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';

const dir = new URL('../supabase/migrations/', import.meta.url);
let db: PGlite; let a: string, b: string;
const one = async <T = any>(q: string, p: unknown[] = []) => (await db.query<any>(q, p)).rows[0] as T;
const err = async (p: Promise<unknown>) => { try { await p; return ''; } catch (e) { return (e as Error).message; } };
const jv = (o: any, draft: string | null = null) => one<any>('select create_jv($1::jsonb, $2) id', [JSON.stringify(o), draft]);
const good = () => ({ date: '2026-10-20', memo: 'ปรับปรุง', ref_no: 'REF-1', note: 'โน้ต', lines: [{ account: a, debit: 100, desc: 'บรรทัด 1' }, { account: b, credit: 100 }] });

beforeAll(async () => {
  db = new PGlite(); for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(new URL(f, dir), 'utf8'));
  await db.exec(`insert into accounts(code,name,type) values ('T1','เงินสดทดสอบ','asset'),('T2','รายได้ทดสอบ','revenue')`); a = 'T1'; b = 'T2';
});

describe('M27.1 สมุดรายวัน/JV', () => {
  it('สร้าง JV: ลงเลข JV, เก็บอ้างอิง/โน้ต/คำอธิบายรายการย่อย, เดบิต=เครดิต', async () => {
    const { id } = await jv(good());
    const v = await one<any>('select * from journal_vouchers where id=$1', [id]);
    expect(v.voucher_type).toBe('JV'); expect(v.voucher_no).toMatch(/^JV\d+$/); expect(v.ref_no).toBe('REF-1'); expect(v.note).toBe('โน้ต');
    const ls = (await db.query<any>('select description, debit::float8 d, credit::float8 c from journal_lines where voucher_id=$1 order by line_no', [id])).rows;
    expect(ls[0].description).toBe('บรรทัด 1'); expect(ls[0].d).toBe(100); expect(ls[1].c).toBe(100);
  });
  it('ปฏิเสธ: เดบิตไม่เท่าเครดิต / น้อยกว่า 2 บรรทัด / บัญชีไม่มี / แถวมีทั้งเดบิตและเครดิต / ไม่มีวันที่', async () => {
    expect(await err(jv({ ...good(), lines: [{ account: a, debit: 100 }, { account: b, credit: 90 }] }))).toContain('ไม่เท่ากับ');
    expect(await err(jv({ ...good(), lines: [{ account: a, debit: 100 }] }))).toContain('อย่างน้อย 2');
    expect(await err(jv({ ...good(), lines: [{ account: 'NOPE', debit: 1 }, { account: b, credit: 1 }] }))).toContain('ไม่พบบัญชี');
    expect(await err(jv({ ...good(), lines: [{ account: a, debit: 1, credit: 1 }, { account: b, credit: 0 }] }))).toContain('เดบิตหรือเครดิตอย่างใดอย่างหนึ่ง');
    expect(await err(jv({ ...good(), date: '' }))).toContain('ต้องระบุวันที่');
  });
  it('งวดที่ล็อกแล้วสร้าง JV ไม่ได้', async () => {
    const lock = await one<any>(`select lock_period('2025-01-01','2025-01-31','ทดสอบ') id`);
    expect(await err(jv({ ...good(), date: '2025-01-15' }))).toContain('PERIOD_LOCKED');
    await db.query('select release_period_lock($1)', [lock.id]);
  });
  it('ร่าง: บันทึก/แก้/อนุมัติแล้วร่างหาย · ร่างไม่กระทบงบทดลอง · เลข Draft JV รันต่อเนื่อง', async () => {
    const before = +(await one<any>('select count(*) c from journal_lines')).c;
    const d1 = (await one<any>('select save_jv_draft(null, $1::jsonb) id', [JSON.stringify({ date: '2026-10-21', lines: [{ account: a, debit: 5 }] })])).id;
    const d2 = (await one<any>('select save_jv_draft(null, $1::jsonb) id', [JSON.stringify({ memo: 'x' })])).id;
    expect(await db.query<any>('select draft_no from jv_drafts order by created_at, draft_no').then(r => r.rows.map(x => x.draft_no))).toEqual(['Draft JV1', 'Draft JV2']);
    await db.query('select save_jv_draft($1, $2::jsonb)', [d1, JSON.stringify({ ...good(), date: '2026-10-21' })]);
    expect(+(await one<any>('select count(*) c from journal_lines')).c).toBe(before);
    await jv({ ...good(), date: '2026-10-21' }, d1);
    expect(+(await one<any>('select count(*) c from jv_drafts where id=$1', [d1])).c).toBe(0);
    await db.query('select delete_jv_draft($1)', [d2]);
    expect(await err(db.query('select delete_jv_draft($1)', [d2]))).toContain('ไม่พบร่าง');
  });
  it('journal_list: กรองชนิด/ค้นหา/แบ่งหน้า · สถานะ reversed/reversal', async () => {
    const { id } = await jv({ ...good(), memo: 'ค้นหาฉัน-สมุด' });
    await db.query('select reverse_voucher($1)', [id]);
    const no = (await one<any>('select voucher_no n from journal_vouchers where id=$1', [id])).n;
    expect((await db.query<any>(`select * from journal_list(array['JV'], null, null, 'ค้นหาฉัน', 50, 0)`)).rows.length).toBe(1);
    const rows = (await db.query<any>(`select * from journal_list(array['JV'], null, null, $1, 50, 0)`, [no])).rows;
    expect(rows.map(r => r.status).sort()).toEqual(['reversal', 'reversed']);
    expect(rows.every(r => Number(r.total) === 100 && Number(r.total_rows) === 2)).toBe(true);
    expect((await db.query<any>(`select * from journal_list(array['SV'], null, null, $1, 50, 0)`, [no])).rows.length).toBe(0);
    expect((await db.query<any>(`select * from journal_list(null, null, null, null, 1, 0)`)).rows.length).toBe(1);
  });
});
