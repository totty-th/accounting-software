import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';

const dir = new URL('../supabase/migrations/', import.meta.url);
let db: PGlite;
let cust: string;

const ACCOUNTS: [string, string, string][] = [
  ['11112', 'เงินสด', 'asset'], ['11122', 'เงินฝากธนาคาร', 'asset'], ['11311', 'ลูกหนี้', 'asset'], ['11319', 'ใบเสร็จรอเรียกเก็บ', 'asset'],
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
  await db.exec(`truncate receipt_payments, bank_accounts, receipt_items, receipts, billing_note_items, sales_doc_lines, sales_docs, contacts, journal_lines,
                 journal_vouchers, period_locks, doc_sequences, accounts cascade`);
  for (const [c, n, t] of ACCOUNTS) await db.query('insert into accounts(code,name,type) values ($1,$2,$3)', [c, n, t]);
  cust = (await one<{ id: string }>(`insert into contacts(business_name) values ('ลูกค้าทดสอบ') returning id`)).id;
});

describe('M17 ใบเสร็จ: ช่องทางรับชำระและลิงก์แชร์', () => {
  it('ไม่ระบุช่องทาง = เงินสดเต็มจำนวน และมีใน receipt_view', async () => {
    const re = await RE(await doc('INV', D, svc(1000)));
    await call('select collect_receipt($1,$2::date)', [re, D]);
    const v = (await one<{ v: any }>('select receipt_view($1) as v', [re])).v;
    expect(v.payments).toEqual([{ method: 'cash', bank: null, ref_no: null, pay_date: D, amount: 1070 }]);
  });
  it('หลายช่องทาง: โอนเข้าบัญชีธนาคารที่เลือก, เงินสดเข้า 11112, รวมต้องเท่ายอดสุทธิ', async () => {
    const inv = await doc('INV', D, svc(10000));
    await call('select set_invoice_wht($1,3)', [inv]);
    const re = await RE(inv);   // amount 10700 wht 300 → net 10400
    const k = (await one<{ id: string }>(`select bank_account_create('กสิกรไทย','748-2-31004-9','บจก.') as id`)).id;
    const kb = (await one<{ id: string }>(`select bank_account_create('กรุงไทย','111-1-11111-1') as id`)).id;
    const code = async (id: string) => (await one<{ c: string }>('select a.code c from bank_accounts b join accounts a on a.id=b.account_id where b.id=$1', [id])).c;
    const bad = JSON.stringify([{ method: 'cash', amount: 400 }, { method: 'transfer', bank_account_id: k, amount: 9000 }]);
    expect(await err(call('select collect_receipt($1,$2::date,$3::jsonb)', [re, D, bad]))).toContain('ไม่เท่ายอดรับสุทธิ');
    expect(await err(call('select collect_receipt($1,$2::date,$3::jsonb)', [re, D, JSON.stringify([{ method: 'transfer', amount: 10400 }])]))).toContain('เลือกบัญชีรับเงิน');
    expect((await rc(re)).status).toBe('pending');
    const ok = JSON.stringify([{ method: 'cash', amount: 400 }, { method: 'transfer', bank_account_id: k, amount: 6000 }, { method: 'transfer', bank_account_id: kb, amount: 4000 }]);
    await call('select collect_receipt($1,$2::date,$3::jsonb)', [re, D, ok]);
    const p = (await call('select method, bank, ref_no, amount from receipt_payments where receipt_id=$1 order by line_no', [re])).rows as any[];
    expect(p.map(x => [x.method, x.bank, x.ref_no, +x.amount])).toEqual([['cash', null, null, 400],
      ['transfer', 'กสิกรไทย', '748-2-31004-9', 6000], ['transfer', 'กรุงไทย', '111-1-11111-1', 4000]]);
    const e = await entries((await rc(re)).collect_voucher_id);
    expect(e).toEqual(expect.arrayContaining([['11112', 400, 0], [await code(k), 6000, 0], [await code(kb), 4000, 0], ['17120', 300, 0], ['11319', 0, 10700]]));
    expect(e).toHaveLength(5);
  });
  it('ช่องทางไม่ถูกต้องถูกปฏิเสธ และรีเซ็ตล้างช่องทาง', async () => {
    const re = await RE(await doc('INV', D, svc(1000)));
    expect(await err(call('select collect_receipt($1,$2::date,$3::jsonb)', [re, D, JSON.stringify([{ method: 'bitcoin', amount: 1070 }])]))).toContain('ช่องทาง');
    await call('select collect_receipt($1,$2::date)', [re, D]);
    await call('select reset_receipt($1)', [re]);
    expect((await one<{ n: number }>('select count(*)::int n from receipt_payments where receipt_id=$1', [re])).n).toBe(0);
  });
  it('ลิงก์แชร์: สร้างซ้ำได้โทเคนเดิม, ค้นด้วยโทเคน, ยกเลิกแล้วค้นไม่เจอ', async () => {
    const re = await RE(await doc('INV', D, svc(1000)));
    const t1 = (await one<{ t: string }>('select ensure_receipt_share_token($1) t', [re])).t;
    const t2 = (await one<{ t: string }>('select ensure_receipt_share_token($1) t', [re])).t;
    expect(t1).toBe(t2);
    expect((await one<{ id: string }>('select receipt_by_token($1) id', [t1])).id).toBe(re);
    await call('select revoke_receipt_share_token($1)', [re]);
    expect((await one<{ id: string | null }>('select receipt_by_token($1) id', [t1])).id).toBeNull();
    expect((await one<{ id: string | null }>('select receipt_by_token(null) id')).id).toBeNull();
  });
});
