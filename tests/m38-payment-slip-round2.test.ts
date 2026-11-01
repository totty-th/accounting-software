import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';

const dir = new URL('../supabase/migrations/', import.meta.url);
let db: PGlite; let v1: string, v2: string;
const ACCOUNTS: [string, string, string][] = [
  ['11112', 'เงินสด', 'asset'], ['11122', 'ธนาคาร', 'asset'], ['17113', 'ภาษีซื้อ', 'asset'], ['21311', 'เจ้าหนี้การค้า', 'liability'],
  ['21399', 'เจ้าหนี้อื่นๆ', 'liability'], ['27124', 'ภาษีหัก ณ ที่จ่าย', 'liability'], ['53101', 'ค่าบริการ', 'expense'],
];
const D = '2026-10-15';
const err = async (p: Promise<unknown>) => { try { await p; return ''; } catch (e) { return (e as Error).message; } };
const one = async <T = any>(q: string, a: unknown[] = []) => (await db.query<any>(q, a)).rows[0] as T;
const call = (q: string, a: unknown[] = []) => db.query(q, a);
const ex = async (v: string, price: number) => (await one<any>('select create_expense($1::date,$2,$3::jsonb) id',
  [D, v, JSON.stringify([{ description: 'x', account: '53101', qty: 1, unit_price: price }])])).id;
const slip = async (docs: object[], d = D) => (await one<any>('select create_payment_slip($1::date,$1::date,$2::jsonb) id', [d, JSON.stringify(docs)])).id;
const st = async (id: string) => (await one<any>('select status from expenses where id=$1', [id])).status;
const tb = async (code: string) => +((await one<any>(`select coalesce(sum(closing),0) c from trial_balance('2026-10-01','2026-10-31',false) where code=$1`, [code])).c);
const events = async (s: string) => (await db.query<any>('select text from payment_slip_events where slip_id=$1 order by id', [s])).rows.map(r => r.text as string);

beforeAll(async () => { db = new PGlite(); for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(new URL(f, dir), 'utf8')); });
beforeEach(async () => {
  await db.exec(`truncate payment_slip_events, payment_slip_items, payment_slips, purchase_payments, wht_certs, expense_lines, expenses, contacts,
    journal_lines, journal_vouchers, period_locks, doc_sequences, accounts cascade`);
  for (const [c, n, t] of ACCOUNTS) await db.query('insert into accounts(code,name,type) values ($1,$2,$3)', [c, n, t]);
  v1 = (await one<any>(`insert into contacts(business_name) values ('ผู้ขาย A') returning id`)).id;
  v2 = (await one<any>(`insert into contacts(business_name) values ('ผู้ขาย B') returning id`)).id;
});

describe('M38 ใบเตรียมจ่าย รอบ 2', () => {
  it('ยกเลิกใบที่จ่ายแล้ว: กลับรายการจ่าย เอกสารกลับค้างจ่าย แต่ยังถูกล็อกกับใบที่ยกเลิก', async () => {
    const e = await ex(v1, 1000); const s = await slip([{ type: 'EXP', id: e }]);
    await call('select pay_payment_slip_vendor($1,$2,$3::date)', [s, v1, D]);
    expect(await st(e)).toBe('paid'); expect(await tb('11112')).toBe(-1070);
    await call('select cancel_payment_slip($1)', [s]);
    expect((await one<any>('select status from payment_slips where id=$1', [s])).status).toBe('cancelled');
    expect(await st(e)).not.toBe('paid'); expect(await tb('11112')).toBe(0);
    expect(await err(slip([{ type: 'EXP', id: e }]))).toContain('อยู่ในใบเตรียมจ่ายอื่นแล้ว');
    const ev = await events(s); expect(ev[0]).toContain('สร้างเอกสาร'); expect(ev.some(x => x.startsWith('บันทึกการชำระเงิน'))).toBe(true);
    expect(ev.some(x => x.startsWith('กลับรายการชำระเงิน'))).toBe(true); expect(ev.at(-1)).toBe('ยกเลิกเอกสาร');
  });
  it('ลบ: ใบที่ยกเลิก/จ่ายแล้ว/ไม่ใช่เลขล่าสุดลบไม่ได้ · ใบล่าสุดที่รอดำเนินการลบได้', async () => {
    const a = await ex(v1, 100), b = await ex(v1, 200), c = await ex(v1, 300);
    const s1 = await slip([{ type: 'EXP', id: a }]); const s2 = await slip([{ type: 'EXP', id: b }]);
    expect(await err(call('select delete_payment_slip($1)', [s1]))).toContain('เลขที่เอกสารไม่ต่อเนื่อง');
    await call('select cancel_payment_slip($1)', [s2]);
    expect(await err(call('select delete_payment_slip($1)', [s2]))).toContain('ไม่สามารถลบเอกสารได้');
    const s3 = await slip([{ type: 'EXP', id: c }]); await call('select pay_payment_slip_vendor($1,$2,$3::date)', [s3, v1, D]);
    expect(await err(call('select delete_payment_slip($1)', [s3]))).toContain('ไม่สามารถลบเอกสารได้');
    await call('select reset_payment_slip($1)', [s3]); await call('select delete_payment_slip($1)', [s3]);
    expect((await one<any>('select count(*)::int n from payment_slips where id=$1', [s3])).n).toBe(0);
  });
  it('เพิ่ม/ลบเอกสารหลังบันทึก: ผู้จำหน่ายเดียวกัน เฉพาะใบที่ยังไม่จ่าย อย่างน้อย 1 รายการ', async () => {
    const a = await ex(v1, 100), b = await ex(v1, 200), o = await ex(v2, 50);
    const s = await slip([{ type: 'EXP', id: a }]);
    expect(await err(call(`select add_slip_doc($1,'EXP',$2)`, [s, o]))).toContain('ผู้จำหน่ายเดียวกับใบ');
    await call(`select add_slip_doc($1,'EXP',$2)`, [s, b]);
    expect(await err(call(`select add_slip_doc($1,'EXP',$2)`, [s, b]))).toContain('อยู่ในใบเตรียมจ่ายอื่นแล้ว');
    await call('select remove_slip_doc($1,2)', [s]);
    expect(await err(call('select remove_slip_doc($1,1)', [s]))).toContain('อย่างน้อย 1');
    await call(`select add_slip_doc($1,'EXP',$2)`, [s, b]); await call('select pay_payment_slip_vendor($1,$2,$3::date)', [s, v1, D]);
    expect(await err(call(`select add_slip_doc($1,'EXP',$2)`, [s, o]))).toContain('ยังไม่ชำระเงิน');
    const ev = await events(s); expect(ev.some(x => x.includes('เพิ่ม')) && ev.some(x => x.includes('ลบ'))).toBe(true);
  });
  it('แก้เลขที่เอกสาร: รูปแบบ ซ้ำ และเกินลำดับล่าสุด', async () => {
    const a = await ex(v1, 100), b = await ex(v1, 200);
    const s1 = await slip([{ type: 'EXP', id: a }]); const s2 = await slip([{ type: 'EXP', id: b }]);
    const no1 = (await one<any>('select pay_no from payment_slips where id=$1', [s1])).pay_no as string; const pre = no1.slice(0, 11);
    expect(await err(call('select rename_payment_slip($1,$2)', [s1, 'X1']))).toContain('รูปแบบ');
    expect(await err(call('select rename_payment_slip($1,$2)', [s1, pre + '0002']))).toContain('ซ้ำ');
    expect(await err(call('select rename_payment_slip($1,$2)', [s1, pre + '0009']))).toContain('เกินลำดับล่าสุด');
    await call('select delete_payment_slip($1)', [s2]);
    await call('select rename_payment_slip($1,$2)', [s1, pre + '0001']);
    expect((await events(s1)).length).toBeGreaterThan(0);
  });
});
