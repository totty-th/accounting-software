import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';

const dir = new URL('../supabase/migrations/', import.meta.url);
let db: PGlite, c: string;
const ACC: [string, string, string][] = [['11311', 'ลูกหนี้', 'asset'], ['27111', 'ภาษีขาย', 'liability'], ['41110', 'รายได้', 'revenue'], ['41210', 'รายได้บริการ', 'revenue']];
const one = async (s: string, a: unknown[] = []) => (await db.query<any>(s, a)).rows[0];
const rows = async (s: string, a: unknown[] = []) => (await db.query<any>(s, a)).rows;
const lines = JSON.stringify([{ description: 'งาน', qty: 1, unit_price: 1000 }]);

beforeAll(async () => { db = new PGlite(); for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(new URL(f, dir), 'utf8')); });
beforeEach(async () => {
  await db.exec(`truncate receipt_items, receipts, billing_note_items, sales_doc_lines, sales_docs, contacts, journal_lines, journal_vouchers, period_locks, doc_sequences, accounts cascade`);
  for (const [a, n, t] of ACC) await db.query('insert into accounts(code,name,type) values ($1,$2,$3)', [a, n, t]);
  c = (await one(`insert into contacts(business_name) values ('ลูกค้า') returning id`)).id;
});

describe('M25.7 ลูกหนี้ตามเอกสาร: ใบวางบิลที่ยังไม่วางบิล (ตัวเลือกแบบ FA)', () => {
  it('BL จาก QT = รอวางบิล → ปรากฏใน ar_aging_bl ไม่ปนใน ar_aging · BL ที่รวมใบแจ้งหนี้แล้วไม่ปรากฏ', async () => {
    const qt = (await one(`select create_sales_doc('QT','2026-10-24',$1,$2::jsonb) id`, [c, lines])).id;
    await db.query(`select quotation_bill($1,'BL','2026-10-24')`, [qt]);
    const inv = (await one(`select create_sales_doc('INV','2026-10-22',$1,$2::jsonb) id`, [c, lines])).id;
    await db.query(`select create_billing_note('2026-10-22',$1,$2::uuid[])`, [c, `{${inv}}`]);
    const bl = await rows(`select * from ar_aging_bl('2026-10-25')`);
    expect(bl.length).toBe(1);
    expect(+bl[0].outstanding).toBe(1070);
    expect(bl[0].doc_type).toBe('BL');
    expect((await rows(`select * from ar_aging('2026-10-25')`)).every(r => r.doc_type !== 'BL')).toBe(true);
  });
});
