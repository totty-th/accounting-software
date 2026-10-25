import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';

const dir = new URL('../supabase/migrations/', import.meta.url);
let db: PGlite;
let cust: string;

const ACCOUNTS: [string, string, string][] = [
  ['11112', 'เงินสด', 'asset'], ['11311', 'ลูกหนี้', 'asset'], ['11319', 'ใบเสร็จรอเรียกเก็บ', 'asset'],
  ['17120', 'ภาษีถูกหัก ณ ที่จ่าย', 'asset'], ['27111', 'ภาษีขาย', 'liability'],
  ['41110', 'รายได้ขายสินค้า', 'revenue'], ['41210', 'รายได้บริการ', 'revenue'], ['41400', 'รับคืนและส่วนลด', 'revenue'],
  ['21921', 'เงินมัดจำรับ', 'liability'], ['11922', 'เงินประกัน', 'asset'], ['21398', 'เงินทดรอง', 'liability'],
  ['11921', 'มัดจำจ่าย', 'asset'], ['49910', 'เงินบริจาค', 'revenue'], ['49990', 'รายได้อื่น', 'revenue'],
];
const svc = (price: number) => [{ description: 'บริการ', kind: 'service', qty: 1, unit_price: price }];
const err = async (p: Promise<unknown>) => { try { await p; return ''; } catch (e) { return (e as Error).message; } };
const one = async <T = any>(q: string, a: unknown[] = []) => (await db.query<any>(q, a)).rows[0] as T;

async function doc(type: string, date: string, lines: object[], extra: Record<string, unknown> = {}) {
  return (await one<{ id: string }>(
    `select create_sales_doc($1,$2::date,$3,$4::jsonb,$5,7,$6,$7) as id`,
    [type, date, extra.contact ?? cust, JSON.stringify(lines), extra.mode ?? 'exclusive', extra.ref ?? null, extra.reason ?? null])).id;
}
const sd = (id: string) => one('select * from sales_docs where id=$1', [id]);
const rc = (id: string) => one('select * from receipts where id=$1', [id]);
async function entries(v: string) {
  const r = await db.query<any>(`select a.code, l.debit, l.credit from journal_lines l join accounts a on a.id=l.account_id
    where voucher_id=$1 order by line_no`, [v]);
  return r.rows.map(x => [x.code, +x.debit, +x.credit]);
}
const reversals = async () =>
  (await db.query<any>(`select voucher_no from journal_vouchers where voucher_no like '%-R' order by voucher_no`)).rows.map(x => x.voucher_no);
const call = (sql: string, a: unknown[] = []) => db.query(sql, a);
const D = '2026-10-15';
const RE = (inv: string, amt: number | null = null) =>
  one<{ id: string }>('select create_receipt_from_invoice($1,$2::date,$3) as id', [inv, D, amt]).then(x => x.id);

beforeAll(async () => {
  db = new PGlite();
  for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(new URL(f, dir), 'utf8'));
});
beforeEach(async () => {
  await db.exec(`truncate receipt_items, receipts, billing_note_items, sales_doc_lines, sales_docs, contacts, journal_lines,
                 journal_vouchers, period_locks, doc_sequences, accounts cascade`);
  for (const [c, n, t] of ACCOUNTS) await db.query('insert into accounts(code,name,type) values ($1,$2,$3)', [c, n, t]);
  cust = (await one<{ id: string }>(`insert into contacts(business_name) values ('ลูกค้าทดสอบ') returning id`)).id;
});


describe('M24 มัดจำจาก QT แบบ FA', () => {
  it('ออกมัดจำได้ตอนรออนุมัติ · แถว/โน้ตเขียนแบบ FA · QT เป็นมัดจำแล้ว · INV สุดท้ายหักมัดจำ', async () => {
    const q = await doc('QT', D, svc(3200));
    expect((await sd(q)).status).toBe('pending_approval');
    const dep = await sd((await one<{ id: string }>('select create_deposit_invoice($1,$2::date,1000) as id', [q, D])).id);
    expect([+dep.subtotal, +dep.vat, +dep.total, dep.is_deposit]).toEqual([1000, 70, 1070, true]);
    const l = await one('select description, detail from sales_doc_lines where doc_id=$1', [dep.id]);
    expect(l.description).toBe('รับมัดจำ'); expect(l.detail).toContain('มูลค่า 3,424.00 บาท');
    expect(dep.internal_note).toContain('รับเงินมัดจำ');
    expect((await sd(q)).status).toBe('deposit_paid');
    const fin = await sd((await one<{ id: string }>('select create_final_invoice($1,$2::date) as id', [q, D])).id);
    expect([+fin.subtotal, +fin.vat, +fin.total]).toEqual([3200, 154, 2354]);
    expect((await sd(q)).status).toBe('converted');
  });
  it('ไม่อนุมัติ/มีมัดจำแล้วออกมัดจำซ้ำไม่ได้', async () => {
    const q = await doc('QT', D, svc(1000));
    await call('select reject_quotation($1)', [q]);
    expect(await err(call('select create_deposit_invoice($1,$2::date,100)', [q, D]))).toContain('รออนุมัติหรืออนุมัติแล้ว');
  });
});
