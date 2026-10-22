import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';

const dir = new URL('../supabase/migrations/', import.meta.url);
let db: PGlite;
let vendor: string;
const ACCOUNTS: [string, string, string][] = [
  ['11112', 'เงินสด', 'asset'], ['12612', 'คอมพิวเตอร์', 'asset'], ['17113', 'ภาษีซื้อยังไม่ถึงกำหนด', 'asset'],
  ['21399', 'เจ้าหนี้อื่นๆ', 'liability'], ['27124', 'ภาษีหัก ณ ที่จ่าย ภ.ง.ด.53', 'liability'],
  ['53101', 'ค่าบริการ', 'expense'], ['53102', 'ค่าเช่า', 'expense'],
];
const D = '2026-10-15';
const err = async (p: Promise<unknown>) => { try { await p; return ''; } catch (e) { return (e as Error).message; } };
const one = async <T = any>(q: string, a: unknown[] = []) => (await db.query<any>(q, a)).rows[0] as T;
const call = (q: string, a: unknown[] = []) => db.query(q, a);
const line = (account: string, price: number, extra: object = {}) =>
  ({ description: 'รายการ', account, qty: 1, unit_price: price, ...extra });
const exp = async (lines: object[], mode = 'exclusive') =>
  (await one<{ id: string }>('select create_expense($1::date,$2,$3::jsonb,$4) as id', [D, vendor, JSON.stringify(lines), mode])).id;
const ex = (id: string) => one('select * from expenses where id=$1', [id]);
async function entries(v: string) {
  const r = await db.query<any>(`select a.code, l.debit, l.credit from journal_lines l join accounts a on a.id=l.account_id
    where voucher_id=$1 order by line_no`, [v]);
  return r.rows.map(x => [x.code, +x.debit, +x.credit]);
}
const nVouchers = async () => +(await one<any>('select count(*) c from journal_vouchers')).c;
const reversals = async () =>
  (await db.query<any>(`select voucher_no from journal_vouchers where voucher_no like '%-R' order by voucher_no`)).rows.map(x => x.voucher_no);
const certs = async () => (await db.query<any>('select * from wht_certs order by created_at, cert_no')).rows;

beforeAll(async () => {
  db = new PGlite();
  for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(new URL(f, dir), 'utf8'));
});
beforeEach(async () => {
  await db.exec(`truncate wht_certs, expense_lines, expenses, receipt_items, receipts, billing_note_items, sales_doc_lines,
                 sales_docs, contacts, journal_lines, journal_vouchers, period_locks, doc_sequences, accounts cascade`);
  for (const [c, n, t] of ACCOUNTS) await db.query('insert into accounts(code,name,type) values ($1,$2,$3)', [c, n, t]);
  vendor = (await one<{ id: string }>(`insert into contacts(business_name) values ('ผู้ขายทดสอบ') returning id`)).id;
});

describe('PUR-02 บันทึกค่าใช้จ่าย', () => {
  it('ซื้อคอมพิวเตอร์ 30,000 + VAT 2,100 → UV ทันที', async () => {
    const id = await exp([line('12612', 30000)]);
    const e = await ex(id);
    expect([e.status, +e.subtotal, +e.vat, +e.total]).toEqual(['pending', 30000, 2100, 32100]);
    expect(e.exp_no).toBe('EXP202610150001');
    expect(await entries(e.uv_voucher_id)).toEqual([['12612', 30000, 0], ['17113', 2100, 0], ['21399', 0, 32100]]);
  });
  it('อนุมัติไม่สร้างรายการบัญชี', async () => {
    const id = await exp([line('12612', 1000)]);
    const before = await nVouchers();
    await call('select approve_expense($1)', [id]);
    expect(await nVouchers()).toBe(before);
    expect((await ex(id)).status).toBe('approved');
    expect(await err(call('select approve_expense($1)', [id]))).toContain('รอดำเนินการ');
  });
  it('VAT และ WHT ต่อบรรทัด · ราคารวม VAT', async () => {
    const id = await exp([line('53101', 10000, { wht_rate: 3 }), line('53102', 5000, { vat_rate: 0, wht_rate: 5 })]);
    const e = await ex(id);
    expect([+e.subtotal, +e.vat, +e.total, +e.wht_total]).toEqual([15000, 700, 15700, 550]);
    const inc = await ex(await exp([line('53101', 10700)], 'inclusive'));
    expect([+inc.subtotal, +inc.vat, +inc.total]).toEqual([10000, 700, 10700]);
  });
  it('บัญชีที่ไม่มีอยู่ บันทึกไม่ได้ และไม่เหลือเอกสารค้าง', async () => {
    expect(await err(exp([line('99999', 1)]))).toContain('ไม่พบบัญชี');
    expect(+(await one<any>('select count(*) c from expenses')).c).toBe(0);
  });
});

describe('PUR-04 จ่ายเงิน', () => {
  it('PV Dr 21399 / Cr 11112', async () => {
    const id = await exp([line('12612', 30000)]);
    const v = (await one<any>('select pay_expense($1,$2::date) as v', [id, D])).v;
    expect(await entries(v)).toEqual([['21399', 32100, 0], ['11112', 0, 32100]]);
    expect((await ex(id)).status).toBe('paid');
    expect(await certs()).toHaveLength(0);
    expect(await err(call('select pay_expense($1,$2::date)', [id, D]))).toContain('รอดำเนินการหรืออนุมัติแล้ว');
  });
  it('จ่ายหลังอนุมัติได้', async () => {
    const id = await exp([line('53101', 100)]);
    await call('select approve_expense($1)', [id]);
    await call('select pay_expense($1,$2::date)', [id, D]);
    expect((await ex(id)).status).toBe('paid');
  });
});

describe('WHT-01..04 หัก ณ ที่จ่าย (AT-03)', () => {
  const payWht = async () => {
    const id = await exp([line('53101', 10000, { wht_rate: 3 })]);
    const v = (await one<any>(`select pay_expense($1,$2::date,'11112',true,'PND53','5. การจ่ายเงินได้ตามคำสั่งกรมสรรพากร') as v`, [id, D])).v;
    return { id, v };
  };
  it('PV แยก WHT ไป 27124 และสร้างหนังสือรับรองอัตโนมัติ', async () => {
    const { id, v } = await payWht();
    const e = await ex(id);
    expect([+e.total, +e.wht_total]).toEqual([10700, 300]);
    expect(await entries(v)).toEqual([['21399', 10700, 0], ['27124', 0, 300], ['11112', 0, 10400]]);
    const c = await certs();
    expect(c).toHaveLength(1);
    expect([c[0].cert_no, c[0].status, +c[0].wht_amount, +c[0].base_amount, c[0].form_code])
      .toEqual(['WT202610150001', 'active', 300, 10000, 'PND53']);
  });
  it('รีเซ็ตแล้วหนังสือรับรองถูกยกเลิกอัตโนมัติ · จ่ายใหม่ได้เลขใหม่', async () => {
    const { id } = await payWht();
    await call('select reset_expense($1)', [id]);
    expect((await ex(id)).status).toBe('pending');
    expect((await certs())[0].status).toBe('cancelled');
    expect(await reversals()).toEqual(['PV0001-R']);
    await call(`select pay_expense($1,$2::date)`, [id, D]);
    const c = await certs();
    expect(c.map((x: any) => [x.cert_no, x.status])).toEqual([['WT202610150001', 'cancelled'], ['WT202610150002', 'active']]);
  });
  it('ปิดสวิตช์ไม่สร้างหนังสือรับรอง แต่ PV ยังแยก WHT', async () => {
    const id = await exp([line('53101', 10000, { wht_rate: 3 })]);
    const v = (await one<any>(`select pay_expense($1,$2::date,'11112',false) as v`, [id, D])).v;
    expect(await certs()).toHaveLength(0);
    expect(await entries(v)).toContainEqual(['27124', 0, 300]);
  });
  it('ภ.ง.ด.3 ยังไม่กำหนดบัญชี → จ่ายไม่ได้และไม่เปลี่ยนสถานะ', async () => {
    const id = await exp([line('53101', 10000, { wht_rate: 3 })]);
    expect(await err(call(`select pay_expense($1,$2::date,'11112',true,'PND3')`, [id, D]))).toContain('ยังไม่ได้กำหนดบัญชี');
    expect((await ex(id)).status).toBe('pending');
  });
  it('ยกเลิกหนังสือรับรองเดี่ยวๆ ได้ ไม่กระทบรายการบัญชี', async () => {
    await payWht();
    const n = await nVouchers();
    await call('select cancel_wht_cert($1)', [(await certs())[0].id]);
    expect(await nVouchers()).toBe(n);
    expect(await err(call('select cancel_wht_cert($1)', [(await certs())[0].id]))).toContain('ไม่พบ');
  });
});

describe('PUR-05/06 รีเซ็ตและยกเลิก', () => {
  it('รีเซ็ตจากชำระแล้วกลับ "รอดำเนินการ" (ข้ามอนุมัติ) PV ได้ -R', async () => {
    const id = await exp([line('53101', 100)]);
    await call('select approve_expense($1)', [id]);
    await call('select pay_expense($1,$2::date)', [id, D]);
    await call('select reset_expense($1)', [id]);
    expect((await ex(id)).status).toBe('pending');
    expect(await reversals()).toEqual(['PV0001-R']);
  });
  it('รีเซ็ตจากอนุมัติกลับรอดำเนินการ ไม่มีรายการบัญชีเพิ่ม', async () => {
    const id = await exp([line('53101', 100)]);
    await call('select approve_expense($1)', [id]);
    const n = await nVouchers();
    await call('select reset_expense($1)', [id]);
    expect(await nVouchers()).toBe(n);
    expect(await err(call('select reset_expense($1)', [id]))).toContain('อนุมัติหรือชำระแล้ว');
  });
  it('ยกเลิกที่จ่ายแล้ว: UV และ PV ได้ -R ทั้งคู่ งบทดลองเป็นศูนย์', async () => {
    const id = await exp([line('12612', 30000)]);
    await call('select pay_expense($1,$2::date)', [id, D]);
    await call('select cancel_expense($1)', [id]);
    expect((await ex(id)).status).toBe('cancelled');
    expect(await reversals()).toEqual(['PV0001-R', 'UV0001-R']);
    const tb = await one<any>(`select coalesce(sum(abs(closing)),0) s from trial_balance('2026-10-01','2026-10-31',false)`);
    expect(+tb.s).toBe(0);
    expect(await err(call('select cancel_expense($1)', [id]))).toContain('ถูกยกเลิกแล้ว');
  });
  it('จ่ายเงินวันที่อยู่ในงวดที่ล็อก: บล็อกและสถานะไม่เปลี่ยน', async () => {
    const past = (d: number) => new Date(Date.now() + 7 * 36e5 - d * 864e5).toISOString().slice(0, 10);
    const id = await exp([line('53101', 100)]);
    await call('select lock_period($1::date,$2::date,$3)', [past(20), past(5), 'ปิดงวด']);
    expect(await err(call('select pay_expense($1,$2::date)', [id, past(10)]))).toContain('PERIOD_LOCKED');
    expect((await ex(id)).status).toBe('pending');
  });
});
