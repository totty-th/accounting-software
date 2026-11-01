import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';

const dir = new URL('../supabase/migrations/', import.meta.url);
let db: PGlite;
const ACCOUNTS: [string, string, string][] = [
  ['11112', 'เงินสด', 'asset'], ['31000', 'ทุน', 'equity'], ['32000', 'กำไรสะสม', 'equity'], ['34200', 'กำไร(ขาดทุน)สะสม', 'equity'],
  ['41210', 'รายได้บริการ', 'revenue'], ['53101', 'ค่าบริการ', 'expense'],
];
const err = async (p: Promise<unknown>) => { try { await p; return ''; } catch (e) { return (e as Error).message; } };
const one = async <T = any>(q: string, a: unknown[] = []) => (await db.query<any>(q, a)).rows[0] as T;
const call = (q: string, a: unknown[] = []) => db.query(q, a);
const post = (date: string, lines: object[]) => one(`select post_voucher('JV',$1::date,null,null,null,$2::jsonb) id`, [date, JSON.stringify(lines)]);
const income = (d: string, n: number) => post(d, [{ account: '11112', debit: n }, { account: '41210', credit: n }]);
const cost = (d: string, n: number) => post(d, [{ account: '53101', debit: n }, { account: '11112', credit: n }]);
const entries = async (v: string) => (await db.query<any>(`select a.code, l.debit, l.credit from journal_lines l join accounts a on a.id=l.account_id where voucher_id=$1 order by line_no`, [v])).rows.map(x => [x.code, +x.debit, +x.credit]);

beforeAll(async () => { db = new PGlite(); for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(new URL(f, dir), 'utf8')); });
beforeEach(async () => {
  await db.exec(`truncate period_closings, year_closes, journal_lines, journal_vouchers, period_locks, doc_sequences, accounts cascade`);
  for (const [c, n, t] of ACCOUNTS) await db.query('insert into accounts(code,name,type) values ($1,$2,$3)', [c, n, t]);
});

describe('M31 ปิดงบบัญชีรายได้และค่าใช้จ่าย (เลือกช่วงวันที่ได้)', () => {
  it('ปิดรายเดือน: รอดำเนินการ → อนุมัติ ลง CP · ค่าตั้งต้นบัญชีผลต่าง 34200 · เลขเอกสาร CREyyyymmdd0001', async () => {
    await income('2026-10-10', 1000); await cost('2026-10-20', 18000); await income('2026-11-05', 500);
    const id = (await one(`select create_period_closing('2026-11-01','2026-10-01','2026-10-31') id`)).id;
    let c = await one(`select * from period_closings where id=$1`, [id]);
    expect([c.doc_no, c.status, +c.total_revenue, +c.total_expense, c.equity_account, c.voucher_id]).toEqual(['CRE202611010001', 'pending', 1000, 18000, '34200', null]);
    const v = (await one(`select approve_period_closing($1) v`, [id])).v;
    expect(await entries(v)).toEqual([['41210', 1000, 0], ['53101', 0, 18000], ['34200', 17000, 0]]);
    c = await one(`select status, voucher_id from period_closings where id=$1`, [id]);
    expect(c.status).toBe('approved');
    expect(+(await one(`select net_profit('2026-10-01','2026-11-30') p`)).p).toBe(-16500);
  });
  it('ห้ามรอบทับกับเอกสารเดิม (รวมที่ยังรอดำเนินการ) · รอบที่ไม่ทับปิดได้ · ปีทับเดือนที่ปิดแล้วไม่ได้', async () => {
    await income('2026-10-10', 1000); await income('2026-11-10', 700);
    const a = (await one(`select create_period_closing('2026-11-01','2026-10-01','2026-10-31') id`)).id;
    expect(await err(call(`select create_period_closing('2026-11-01','2026-01-01','2026-12-31')`))).toContain('CRE202611010001');
    await call(`select create_period_closing('2026-12-01','2026-11-01','2026-11-30')`);
    await call(`select approve_period_closing($1)`, [a]);
    expect(await err(call(`select create_period_closing('2026-12-31','2026-11-15','2026-12-31')`))).toContain('กรุณาอัปเดตข้อมูลที่เอกสาร');
  });
  it('ลบเอกสารอนุมัติแล้ว = กลับรายการ -R และปิดรอบเดิมใหม่ได้ · ลบร่างไม่ลงบัญชี', async () => {
    await income('2026-10-10', 1000);
    const a = (await one(`select create_period_closing('2026-11-01','2026-10-01','2026-10-31', '32000', true) id`)).id;
    const v = (await one(`select voucher_id v from period_closings where id=$1`, [a])).v;
    await call(`select delete_period_closing($1)`, [a]);
    expect((await db.query<any>(`select voucher_no from journal_vouchers where voucher_no like '%-R'`)).rows.length).toBe(1);
    const b = (await one(`select create_period_closing('2026-11-02','2026-10-01','2026-10-31') id`)).id;
    const n0 = +(await one(`select count(*) c from journal_vouchers`)).c;
    await call(`select delete_period_closing($1)`, [b]);
    expect(+(await one(`select count(*) c from journal_vouchers`)).c).toBe(n0);
    expect(v).toBeTruthy();
  });
  it('แก้ไขได้เฉพาะรอดำเนินการ · ไม่มีรายการให้ปิด/บัญชีผลต่างไม่ใช่หมวดทุน/วันที่ย้อนกันถูกปฏิเสธ', async () => {
    await income('2026-10-10', 1000);
    const a = (await one(`select create_period_closing('2026-11-01','2026-10-01','2026-10-31') id`)).id;
    await call(`select update_period_closing($1,'2026-11-03','2026-10-01','2026-10-31','32000')`, [a]);
    expect((await one(`select equity_account e from period_closings where id=$1`, [a])).e).toBe('32000');
    await call(`select approve_period_closing($1)`, [a]);
    expect(await err(call(`select update_period_closing($1,'2026-11-03','2026-10-01','2026-10-31','32000')`, [a]))).toContain('อนุมัติแล้ว');
    expect(await err(call(`select create_period_closing('2026-11-01','2026-09-01','2026-09-30')`))).toContain('ไม่มีรายการ');
    expect(await err(call(`select create_period_closing('2026-11-01','2026-12-01','2026-11-01')`))).toContain('ไม่เกิน');
    expect(await err(call(`select create_period_closing('2026-11-01','2026-12-01','2026-12-31','41210')`))).toContain('หมวดทุน');
  });
});
