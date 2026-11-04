import { COLLECTION_SQL } from '../web/lib/collection-report';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';

// จำลอง flow ฝั่งขาย → รายงานการเก็บเงิน (ใช้ SQL เดียวกับ web/app/reports/collections/page.tsx)
const dir = new URL('../supabase/migrations/', import.meta.url);
let db: PGlite; let cust: string; let bank: string;
const ACCOUNTS: [string, string, string][] = [
  ['11112', 'เงินสด', 'asset'], ['11122', 'ธนาคาร', 'asset'], ['11311', 'ลูกหนี้', 'asset'], ['11319', 'รอเรียกเก็บ', 'asset'],
  ['17120', 'ภาษีถูกหัก', 'asset'], ['27111', 'ภาษีขาย', 'liability'], ['41210', 'รายได้บริการ', 'revenue'], ['41110', 'รายได้ขาย', 'revenue'],
  ['21921', 'มัดจำรับ', 'liability'], ['41400', 'รับคืน', 'revenue'],
];
const D = '2026-10-15';
const one = async <T = any>(q: string, a: unknown[] = []) => (await db.query<any>(q, a)).rows[0] as T;
const mk = async (type: string, price: number, wht = 0) =>
  (await one<any>('select create_invoice_full($1::jsonb,$2::jsonb,null,$3) id', [JSON.stringify({ date: D, contact: cust }),
    JSON.stringify([{ description: 'บริการ', qty: 1, unit_price: price, vat: '7', wht_rate: wht }]), type])).id as string;
const RE = async (inv: string, amt: number | null = null) => (await one<any>('select create_receipt_from_invoice($1,$2::date,$3) id', [inv, D, amt])).id as string;

const REPORT = COLLECTION_SQL;
const rep = async () => Object.fromEntries((await db.query<any>(REPORT, [null, null, '{}'])).rows.map(r => [r.doc_no, r]));
const bal = async (code: string) => +(await one<any>(`select coalesce(sum(l.debit-l.credit),0) b from journal_lines l join accounts a on a.id=l.account_id where a.code=$1`, [code])).b;

beforeAll(async () => {
  db = new PGlite();
  for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(new URL(f, dir), 'utf8'));
});
beforeEach(async () => {
  await db.exec(`truncate receipt_payments, receipt_items, receipts, billing_note_items, sales_doc_lines, sales_docs, stock_movements, product_stock, products, contacts,
                 bank_accounts, journal_lines, journal_vouchers, period_locks, doc_sequences, accounts cascade`);
  for (const [c, n, t] of ACCOUNTS) await db.query('insert into accounts(code,name,type) values ($1,$2,$3)', [c, n, t]);
  cust = (await one<any>(`insert into contacts(business_name,tax_id,credit_days) values ('ลูกค้า ทดสอบ','0105500000001',30) returning id`)).id;
  const ac = (await one<any>(`select id from accounts where code='11122'`)).id;
  bank = (await one<any>(`insert into bank_accounts(account_id,bank_name,account_no) values ($1,'ธนาคารทดสอบ','111-1-11111-1') returning id`, [ac])).id;
});

describe('flow ฝั่งขาย → รายงานการเก็บเงิน', () => {
  it('INV ออกใบเสร็จ+เก็บแบ่งเงินสด/โอน → ช่องทาง cash,transfer ยอดตรงสมุดบัญชี', async () => {
    const inv = await mk('INV', 1000);               // total 1070
    const r = await RE(inv);
    await db.query('select collect_receipt($1,$2::date,$3::jsonb)', [r, D, JSON.stringify([
      { method: 'cash', amount: 500 }, { method: 'transfer', amount: 570, bank_account_id: bank }])]);
    const x = Object.values(await rep())[0] as any;
    expect(x.status).toBe('receipt_opened'); expect(+x.total).toBe(1070);
    expect(x.methods.split(',').sort()).toEqual(['cash', 'transfer']);
    expect(await bal('11112')).toBe(500); expect(await bal('11122')).toBe(570);
  });
  it('INV หัก ณ ที่จ่าย 3%: รับสุทธิ = total − wht และช่องทางรวมต้องเท่ายอดสุทธิ', async () => {
    const inv = await mk('INV', 1000, 3);            // total 1070, wht 30 → รับ 1040
    const r = await RE(inv);
    const rc = await one<any>('select amount, wht from receipts where id=$1', [r]);
    expect(+rc.amount).toBe(1070); expect(+rc.wht).toBe(30);
    await expect(db.query('select collect_receipt($1,$2::date,$3::jsonb)', [r, D, JSON.stringify([{ method: 'cash', amount: 1070 }])])).rejects.toThrow();
    await db.query('select collect_receipt($1,$2::date,$3::jsonb)', [r, D, JSON.stringify([{ method: 'cash', amount: 1040 }])]);
    expect(await bal('11112')).toBe(1040); expect(await bal('17120')).toBe(30);
  });
  it('จ่ายไม่ครบ: split_paid แล้วครบ → collected, ช่องทางรวมทุกใบเสร็จ', async () => {
    const inv = await mk('INV', 1000);
    const r1 = await RE(inv, 400);
    await db.query('select collect_receipt($1,$2::date)', [r1, D]);
    expect(Object.values(await rep())[0]).toMatchObject({ status: 'split_paid', methods: 'cash' });
    const r2 = await RE(inv);
    await db.query('select collect_receipt($1,$2::date,$3::jsonb)', [r2, D, JSON.stringify([{ method: 'transfer', amount: 670, bank_account_id: bank }])]);
    const x = Object.values(await rep())[0] as any;
    expect(x.status).toBe('receipt_opened'); expect(x.methods.split(',').sort()).toEqual(['cash', 'transfer']);
  });
  it('ยกเลิกใบเสร็จ: ช่องทางหาย สถานะ INV กลับเป็นรอเก็บ ยอดบัญชีกลับเป็น 0', async () => {
    const inv = await mk('INV', 1000);
    const r = await RE(inv); await db.query('select collect_receipt($1,$2::date)', [r, D]);
    await db.query('select cancel_receipt($1)', [r]);
    expect(Object.values(await rep())[0]).toMatchObject({ status: 'awaiting_payment', methods: null });
    expect(await bal('11112')).toBe(0);
  });
  it('ขายสด CA เก็บเงินแล้ว: ต้องมีช่องทางรับชำระในรายงาน', async () => {
    const ca = await mk('CA', 1000);
    await db.query('select collect_cash_sale($1,$2::date,$3)', [ca, D, bank]);
    const x = Object.values(await rep())[0] as any;
    expect(x.status).toBe('collected');
    expect(x.methods).toBe('transfer');
  });
});
