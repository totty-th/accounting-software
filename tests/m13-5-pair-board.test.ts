import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { proposePairs, type SLine, type SItem } from '../web/lib/bank-suggest';

// ---- ตรรกะเสนอคู่ (ตรงกับผลที่เห็นบน FA 18-11-2026) ----
describe('M13.5 เสนอคู่ + ป้ายเหตุผล', () => {
  const L = (id: string, date: string, description: string, amount: number): SLine => ({ id, date, description, amount, matched: false });
  const I = (id: string, date: string, no: string, memo: string, amount: number, matched = false): SItem => ({ id, date, no, memo, amount, matched });
  const lines = [L('l1', '2026-10-21', 'ดอกเบี้ยรับ', 500), L('l2', '2026-10-22', 'ค่าธรรมเนียมโอน', -35), L('l3', '2026-10-23', 'รับโอนจาก TEST', 3210), L('l4', '2026-10-24', 'ถอนเงิน', -999)];
  const items = [I('i1', '2026-10-23', 'JV1', 'ดอกเบี้ยรับธนาคาร', 500), I('i2', '2026-10-23', 'JV4', 'ดอกเบี้ย', 500),
    I('i3', '2026-10-23', 'JV2', 'ค่าธรรมเนียมโอน', -35), I('i4', '2026-10-23', 'RE2', 'TEST New Customer', 3210)];
  const by = (ps: ReturnType<typeof proposePairs>, id: string) => ps.find(p => p.lineIds.includes(id))!;
  it('ยอดและวันตรง = รอยืนยัน · วันต่าง/หลายฉบับ = มีข้อสังเกต · ไม่มีเอกสาร = ไม่พบคู่', () => {
    const ps = proposePairs(lines, items);
    expect(ps.map(p => p.lineIds[0])).toEqual(['l1', 'l2', 'l3', 'l4']);   // เรียงตามวันที่ธนาคาร
    expect(by(ps, 'l3')).toMatchObject({ itemIds: ['i4'], status: 'ok' });
    expect(by(ps, 'l3').chips.map(c => c.t)).toContain('ยอดและวันที่ตรงกัน');
    expect(by(ps, 'l2').status).toBe('note');
    expect(by(ps, 'l2').chips.map(c => c.t)).toContain('ยอดตรงกัน แต่วันที่ต่างกัน 1 วัน');
    expect(by(ps, 'l1').status).toBe('note');
    expect(by(ps, 'l1').chips.map(c => c.t)).toContain('มีเอกสารใกล้เคียงหลายฉบับ');
    expect(by(ps, 'l4')).toMatchObject({ itemIds: [], status: 'none' });
  });
  it('× ไม่ใช้คู่ → รายการนั้นเป็น "ไม่พบคู่" และเอกสารว่างให้คู่อื่น', () => {
    const ps = proposePairs(lines, items, new Set(['l3']));
    expect(by(ps, 'l3')).toMatchObject({ itemIds: [], status: 'none' });
    expect(ps.flatMap(p => p.itemIds)).not.toContain('i4');
  });
  it('รายการที่จับคู่แล้วไม่ถูกเสนอ', () => {
    const ps = proposePairs([...lines.slice(0, 2), { ...lines[2], matched: true }], items);
    expect(ps.some(p => p.lineIds.includes('l3'))).toBe(false);
  });
  it('1 รายการธนาคาร = ผลรวมหลายเอกสาร → มีข้อสังเกต', () => {
    const ps = proposePairs([L('x', '2026-11-01', 'รับโอน', 300)], [I('a', '2026-11-01', 'RE1', 'a', 100), I('b', '2026-11-01', 'RE2', 'b', 200)]);
    expect(ps[0]).toMatchObject({ status: 'note' });
    expect(ps[0].itemIds.sort()).toEqual(['a', 'b']);
  });
});

// ---- DB: "+ JV" ไม่มีเอกสาร ----
const sql = readdirSync(new URL('../supabase/migrations/', import.meta.url)).sort()
  .filter(f => ['0001', '0013', '0014', '0099'].some(p => f.startsWith(p)))
  .map(f => readFileSync(new URL('../supabase/migrations/' + f, import.meta.url), 'utf8')).join('\n');
let db: PGlite;
const one = async <T = any>(q: string, p: unknown[] = []) => (await db.query<T>(q, p)).rows[0];
const err = async (p: Promise<unknown>) => { try { await p; return ''; } catch (e) { return (e as Error).message; } };
let bank: string, L: string[];
beforeAll(async () => { db = new PGlite(); await db.exec(sql); });
beforeEach(async () => {
  await db.exec(`truncate bank_reconcile_items, bank_reconcile_groups, bank_statement_lines, bank_statement_batches,
    bank_accounts, journal_lines, journal_vouchers, period_locks, doc_sequences, accounts cascade`);
  for (const [c, n, t] of [['49010', 'ดอกเบี้ยรับ', 'revenue'], ['53211', 'ค่าธรรมเนียมธนาคาร', 'expense']])
    await db.query('insert into accounts(code,name,type) values ($1,$2,$3)', [c, n, t]);
  bank = (await one(`select bank_account_create('กสิกรไทย','111','ทดสอบ') as id`)).id;
  await db.query(`select bank_statement_import($1,'t.csv',$2::jsonb)`, [bank, JSON.stringify([
    { date: '2026-10-21', description: 'ดอกเบี้ย', deposit: 12.5, withdrawal: 0 },
    { date: '2026-10-22', description: 'ค่าธรรมเนียม', deposit: 0, withdrawal: 35 }])]);
  L = (await db.query<{ id: string }>(`select id from bank_statement_lines order by line_no`)).rows.map(r => r.id);
});
describe('M13.5 + JV โดยไม่มีเอกสาร', () => {
  const entries = async (g: string) => (await db.query<any>(`select a.code, l.debit::float, l.credit::float from bank_reconcile_groups gr
    join journal_lines l on l.voucher_id = gr.diff_voucher_id join accounts a on a.id = l.account_id where gr.id = $1 order by l.line_no`, [g])).rows.map(r => [r.code, r.debit, r.credit]);
  it('เงินเข้า: Dr ธนาคาร / Cr บัญชีที่เลือก เต็มยอด และจับคู่แล้ว', async () => {
    const g = (await one(`select bank_match_with_diff($1::uuid[], '{}'::uuid[], '49010', 'ดอกเบี้ยรับ') as g`, [[L[0]]])).g;
    const e = await entries(g);
    expect(e[0][1]).toBe(12.5); expect(e[1]).toEqual(['49010', 0, 12.5]);
    expect((await one(`select group_id from bank_statement_lines where id=$1`, [L[0]])).group_id).toBe(g);
  });
  it('เงินออก: Dr บัญชีที่เลือก / Cr ธนาคาร · ยกเลิกจับคู่ต้องเลือกยกเลิก/คง JV', async () => {
    const g = (await one(`select bank_match_with_diff($1::uuid[], null, '53211', 'ค่าธรรมเนียม', '2026-10-22') as g`, [[L[1]]])).g;
    expect((await entries(g))[0]).toEqual(['53211', 35, 0]);
    expect(await err(db.query(`select bank_unmatch($1)`, [L[1]]))).toContain('DIFF_ACTION_REQUIRED');
    await db.query(`select bank_unmatch($1,'cancel')`, [L[1]]);
    expect((await one(`select group_id from bank_statement_lines where id=$1`, [L[1]])).group_id).toBeNull();
  });
  it('ต้องมีรายการธนาคาร', async () => {
    expect(await err(db.query(`select bank_match_with_diff('{}'::uuid[], '{}'::uuid[], '49010', 'x')`))).toContain('รายการธนาคาร');
  });
});
