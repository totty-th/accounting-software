import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';

// 0013 ต้องการแค่แกนบัญชี (0001) จึงรันสองไฟล์นี้ ไม่ต้องพึ่งโมดูลขาย
const sql = readdirSync(new URL('../supabase/migrations/', import.meta.url)).sort()
  .filter(f => f.startsWith('0001') || f.startsWith('0013') || f.startsWith('0014'))
  .map(f => readFileSync(new URL('../supabase/migrations/' + f, import.meta.url), 'utf8')).join('\n');
let db: PGlite;

const ACCOUNTS: [string, string, string][] = [
  ['11112', 'เงินสด', 'asset'], ['41210', 'รายได้', 'revenue'], ['49010', 'ดอกเบี้ยรับ', 'revenue'],
  ['53211', 'ค่าธรรมเนียมธนาคาร', 'expense'], ['59910', 'ค่าใช้จ่ายเบ็ดเตล็ด', 'expense'],
];
const err = async (p: Promise<unknown>) => { try { await p; return ''; } catch (e) { return (e as Error).message; } };
const one = async <T = any>(q: string, p: unknown[] = []) => (await db.query<T>(q, p)).rows[0];
const rows = async <T = any>(q: string, p: unknown[] = []) => (await db.query<T>(q, p)).rows;

async function post(type: string, date: string, lines: object[]) {
  return (await one<{ id: string }>(`select post_voucher($1,$2::date,'t',null,null,$3::jsonb) as id`,
    [type, date, JSON.stringify(lines)])).id;
}
const itemOf = async (voucher: string) =>
  (await one<{ id: string }>(`select l.id from journal_lines l join bank_accounts b on b.account_id=l.account_id
     where l.voucher_id=$1`, [voucher])).id;
const entries = async (v: string) => (await rows<any>(
  `select a.code, l.debit, l.credit from journal_lines l join accounts a on a.id=l.account_id
    where voucher_id=$1 order by line_no`, [v])).map(r => [r.code, +r.debit, +r.credit]);

let bank: string, bankCode: string;
let L: string[];   // statement lines: 0 = ดอกเบี้ย +500, 1 = ค่าธรรมเนียม −35, 2 = รับโอน +3,210

beforeAll(async () => { db = new PGlite(); await db.exec(sql); });
beforeEach(async () => {
  await db.exec(`truncate bank_reconcile_items, bank_reconcile_groups, bank_statement_lines, bank_statement_batches,
    bank_accounts, journal_lines, journal_vouchers, period_locks, doc_sequences, accounts cascade`);
  for (const [c, n, t] of ACCOUNTS) await db.query('insert into accounts(code,name,type) values ($1,$2,$3)', [c, n, t]);
  bank = (await one<{ id: string }>(`select bank_account_create('กสิกรไทย','748-2-31004-9','บจก. ทดสอบ') as id`)).id;
  bankCode = (await one<{ code: string }>(
    `select a.code from bank_accounts b join accounts a on a.id=b.account_id where b.id=$1`, [bank])).code;
  await db.query(`select bank_statement_import($1,'t.csv',$2::jsonb)`, [bank, JSON.stringify([
    { date: '2026-10-21', description: 'ดอกเบี้ยรับ', deposit: 500, withdrawal: 0, balance: 500 },
    { date: '2026-10-22', description: 'ค่าธรรมเนียมโอน', deposit: 0, withdrawal: 35, balance: 465 },
    { date: '2026-10-23', description: 'รับโอนจากลูกค้า', deposit: 3210, withdrawal: 0, balance: 3675 },
  ])]);
  L = (await rows<{ id: string }>(`select id from bank_statement_lines order by line_no`)).map(r => r.id);
});

describe('M13 บัญชีธนาคารและ statement', () => {
  it('สร้างบัญชีย่อย 11122.01 อัตโนมัติ และเลขถัดไปเป็น .02', async () => {
    expect(bankCode).toBe('11122.01');
    await db.query(`select bank_account_create('กรุงไทย','111-1')`);
    const c = await rows(`select code from accounts where code like '11122.%' order by code`);
    expect(c.map((r: any) => r.code)).toEqual(['11122.01', '11122.02']);
  });
  it('นำเข้าแปลงเงินเข้า/ออกเป็นยอดบวก/ลบ และปฏิเสธแถวที่มีทั้งสองหรือไม่มีเลย', async () => {
    const r = await rows(`select amount from bank_statement_lines order by line_no`);
    expect(r.map((x: any) => +x.amount)).toEqual([500, -35, 3210]);
    const bad = await err(db.query(`select bank_statement_import($1,'x',$2::jsonb)`,
      [bank, JSON.stringify([{ date: '2026-10-24', deposit: 5, withdrawal: 5 }])]));
    expect(bad).toContain('แถว 1');
    const bad2 = await err(db.query(`select bank_statement_import($1,'x',$2::jsonb)`,
      [bank, JSON.stringify([{ date: '2026-10-24', deposit: 0, withdrawal: 0 }])]));
    expect(bad2).toContain('แถว 1');
  });
});

describe('M13.1 statement ซ้ำ', () => {
  const same = [
    { date: '2026-10-21', description: 'ดอกเบี้ยรับ', deposit: 500, withdrawal: 0, balance: 500 },
    { date: '2026-10-24', description: 'ใหม่', deposit: 100, withdrawal: 0, balance: 3775 },
  ];
  it('ตรวจพบแถวที่ซ้ำ และแถวใหม่ไม่ถูกนับ', async () => {
    const r = await rows(`select row_no, is_dup from bank_statement_dups($1,$2::jsonb) order by row_no`, [bank, JSON.stringify(same)]);
    expect(r.map((x: any) => [x.row_no, x.is_dup])).toEqual([[1, true], [2, false]]);
  });
  it('นำเข้าปกติยังนำเข้าทั้งหมด (เตือนอย่างเดียว ไม่บล็อก)', async () => {
    await db.query(`select bank_statement_import($1,'again.csv',$2::jsonb)`, [bank, JSON.stringify(same)]);
    expect(+(await one(`select count(*) c from bank_statement_lines`)).c).toBe(5);
  });
  it('ข้ามรายการซ้ำเมื่อสั่ง skip และเลขบรรทัดต่อเนื่อง', async () => {
    await db.query(`select bank_statement_import($1,'again.csv',$2::jsonb,true)`, [bank, JSON.stringify(same)]);
    expect(+(await one(`select count(*) c from bank_statement_lines`)).c).toBe(4);
    const n = await one(`select line_no from bank_statement_lines where description='ใหม่'`);
    expect(+n.line_no).toBe(1);
  });
  it('ไฟล์ซ้ำทั้งไฟล์ + skip = ปฏิเสธ', async () => {
    const e = await err(db.query(`select bank_statement_import($1,'again.csv',$2::jsonb,true)`, [bank, JSON.stringify([same[0]])]));
    expect(e).toContain('ซ้ำ');
  });
  it('นับตามจำนวนครั้ง: ในระบบมี 1 ไฟล์ใหม่มี 2 เหมือนกัน = ซ้ำ 1 ใหม่ 1', async () => {
    const r = await rows(`select is_dup from bank_statement_dups($1,$2::jsonb) order by row_no`, [bank, JSON.stringify([same[0], same[0]])]);
    expect(r.map((x: any) => x.is_dup)).toEqual([true, false]);
  });
  it('บัญชีธนาคารอื่นไม่ถือว่าซ้ำ', async () => {
    const b2 = (await one<{ id: string }>(`select bank_account_create('กรุงไทย','111-1') as id`)).id;
    const r = await rows(`select is_dup from bank_statement_dups($1,$2::jsonb)`, [b2, JSON.stringify([same[0]])]);
    expect(r[0].is_dup).toBe(false);
  });
});

describe('M13 จับคู่', () => {
  it('จับคู่ 1:1 เมื่อยอดเท่ากัน แล้วสถานะ/ยอดหัวหน้าถูกต้อง', async () => {
    const fee = await post('JV', '2026-10-23', [
      { account: '53211', debit: 35 }, { account: bankCode, credit: 35 }]);
    await db.query('select bank_match($1::uuid[], $2::uuid[])', [[L[1]], [await itemOf(fee)]]);
    const s = await one<any>('select * from bank_reconcile_status($1)', [bank]);
    expect([s.total_lines, s.matched_lines, +s.bank_balance, +s.book_matched, +s.diff])
      .toEqual([3, 1, 3675, -35, 3710]);   // ยอดสมุดนับเฉพาะที่จับคู่แล้ว (ตามต้นแบบ)
  });
  it('ผลรวมไม่เท่ากันถูกปฏิเสธ ไม่มีอะไรถูกจับคู่', async () => {
    const v = await post('JV', '2026-10-23', [{ account: bankCode, debit: 500 }, { account: '49010', credit: 500 }]);
    const m = await err(db.query('select bank_match($1::uuid[], $2::uuid[])', [[L[2]], [await itemOf(v)]]));
    expect(m).toContain('ผลรวมไม่เท่ากัน');
    expect((await one<any>(`select count(*)::int c from bank_statement_lines where group_id is not null`)).c).toBe(0);
  });
  it('N ต่อ N ผลรวมเท่ากัน จับคู่ทั้งกลุ่ม และยกเลิกแถวเดียวปลดทั้งกลุ่ม', async () => {
    const a = await post('JV', '2026-10-23', [{ account: bankCode, debit: 3210 }, { account: '41210', credit: 3210 }]);
    const b = await post('JV', '2026-10-23', [{ account: bankCode, debit: 500 }, { account: '49010', credit: 500 }]);
    await db.query('select bank_match($1::uuid[], $2::uuid[])', [[L[0], L[2]], [await itemOf(a), await itemOf(b)]]);
    expect((await one<any>('select matched_lines m from bank_reconcile_status($1)', [bank])).m).toBe(2);
    await db.query('select bank_unmatch($1)', [L[2]]);
    expect((await one<any>('select matched_lines m from bank_reconcile_status($1)', [bank])).m).toBe(0);
    expect((await one<any>('select count(*)::int c from bank_reconcile_items')).c).toBe(0);
  });
  it('จับคู่ซ้ำรายการที่จับคู่แล้วไม่ได้ และคนละบัญชีไม่ได้', async () => {
    const v = await post('JV', '2026-10-23', [{ account: bankCode, debit: 500 }, { account: '49010', credit: 500 }]);
    const it1 = await itemOf(v);
    await db.query('select bank_match($1::uuid[], $2::uuid[])', [[L[0]], [it1]]);
    expect(await err(db.query('select bank_match($1::uuid[], $2::uuid[])', [[L[0]], [it1]]))).toContain('จับคู่แล้ว');
    const b2 = (await one<{ id: string }>(`select bank_account_create('กรุงไทย','111-1') as id`)).id;
    const b2code = '11122.02';
    const v2 = await post('JV', '2026-10-23', [{ account: b2code, debit: 3210 }, { account: '41210', credit: 3210 }]);
    const e = await err(db.query('select bank_match($1::uuid[], $2::uuid[])', [[L[2]],
      [(await one<{ id: string }>(`select id from journal_lines where voucher_id=$1 and account_id=
        (select account_id from bank_accounts where id=$2)`, [v2, b2])).id]]));
    expect(e).toContain('ไม่ใช่รายการของบัญชีธนาคารนี้');
  });
});

describe('M13 จับคู่แบบมีผลต่าง', () => {
  it('ธนาคารน้อยกว่าเอกสาร: Dr บัญชีที่เลือก / Cr ธนาคาร ลงวันที่รายการธนาคารล่าสุด', async () => {
    // เอกสารโอน 1,000 เทียบกับธนาคาร +500 (ผลต่าง −500)
    const t = await post('JV', '2026-10-23', [{ account: bankCode, debit: 1000 }, { account: '11112', credit: 1000 }]);
    await db.query('select bank_match_with_diff($1::uuid[], $2::uuid[], $3, $4)', [[L[0]], [await itemOf(t)], '59910', 'ทดสอบผลต่าง']);
    const d = await one<any>(`select v.id, v.voucher_date::text d, v.source_type from bank_reconcile_groups g
       join journal_vouchers v on v.id=g.diff_voucher_id`);
    expect(d.d).toBe('2026-10-21'); expect(d.source_type).toBe('bank_diff');
    expect(await entries(d.id)).toEqual([['59910', 500, 0], [bankCode, 0, 500]]);
    const s = await one<any>('select matched_lines m from bank_reconcile_status($1)', [bank]);
    expect(s.m).toBe(1);
  });
  it('ธนาคารมากกว่าเอกสาร: Dr ธนาคาร / Cr บัญชีที่เลือก, วันที่ = ล่าสุดของที่เลือก', async () => {
    const r = await post('JV', '2026-10-23', [{ account: bankCode, debit: 3210 }, { account: '41210', credit: 3210 }]);
    await db.query('select bank_match_with_diff($1::uuid[], $2::uuid[], $3, $4)', [[L[0], L[2]], [await itemOf(r)], '49010', 'ดอกเบี้ยรับ']);
    const d = await one<any>(`select v.id, v.voucher_date::text d from bank_reconcile_groups g
       join journal_vouchers v on v.id=g.diff_voucher_id`);
    expect(d.d).toBe('2026-10-23');
    expect(await entries(d.id)).toEqual([[bankCode, 500, 0], ['49010', 0, 500]]);
  });
  it('ผลต่างเป็น 0 หรือไม่มีคำอธิบายถูกปฏิเสธ', async () => {
    const v = await post('JV', '2026-10-23', [{ account: bankCode, debit: 500 }, { account: '49010', credit: 500 }]);
    expect(await err(db.query('select bank_match_with_diff($1::uuid[], $2::uuid[], $3, $4)',
      [[L[0]], [await itemOf(v)], '49010', 'x']))).toContain('ผลต่างเป็น 0');
    expect(await err(db.query('select bank_match_with_diff($1::uuid[], $2::uuid[], $3, $4)',
      [[L[2]], [await itemOf(v)], '49010', '  ']))).toContain('คำอธิบาย');
  });
  it('ล็อกงวด: สร้าง JV ผลต่างลงวันที่ที่ล็อกไม่ได้ ทั้งธุรกรรมย้อนกลับ', async () => {
    const t = await post('JV', '2026-10-23', [{ account: bankCode, debit: 1000 }, { account: '11112', credit: 1000 }]);
    await db.query(`insert into period_locks(date_from,date_to,reason) values ('2026-10-21','2026-10-21','test')`);
    const e = await err(db.query('select bank_match_with_diff($1::uuid[], $2::uuid[], $3, $4)',
      [[L[0]], [await itemOf(t)], '59910', 'x']));
    expect(e).toContain('PERIOD_LOCKED');
    expect((await one<any>(`select count(*)::int c from journal_vouchers where source_type='bank_diff'`)).c).toBe(0);
    expect((await one<any>(`select count(*)::int c from bank_statement_lines where group_id is not null`)).c).toBe(0);
  });
  it('ล็อกงวดไม่ขวางการจับคู่/ยกเลิกจับคู่ปกติ (ตรวจที่วันที่ใบสำคัญที่ลงเท่านั้น)', async () => {
    const v = await post('JV', '2026-10-23', [{ account: bankCode, debit: 500 }, { account: '49010', credit: 500 }]);
    await db.query(`insert into period_locks(date_from,date_to,reason) values ('2026-10-21','2026-10-22','test')`);
    await db.query('select bank_match($1::uuid[], $2::uuid[])', [[L[0]], [await itemOf(v)]]);
    await db.query('select bank_unmatch($1)', [L[0]]);
    expect((await one<any>('select matched_lines m from bank_reconcile_status($1)', [bank])).m).toBe(0);
  });
});

describe('M13 ยกเลิกจับคู่และการล็อกใบสำคัญ', () => {
  async function diffGroup() {
    const t = await post('JV', '2026-10-23', [{ account: bankCode, debit: 1000 }, { account: '11112', credit: 1000 }]);
    await db.query('select bank_match_with_diff($1::uuid[], $2::uuid[], $3, $4)', [[L[0]], [await itemOf(t)], '59910', 'ผลต่าง']);
    return t;
  }
  it('มี JV ผลต่าง ต้องระบุ cancel/keep', async () => {
    await diffGroup();
    expect(await err(db.query('select bank_unmatch($1)', [L[0]]))).toContain('DIFF_ACTION_REQUIRED');
    expect((await one<any>('select matched_lines m from bank_reconcile_status($1)', [bank])).m).toBe(1);
  });
  it("'cancel' กลับรายการ JV ผลต่าง (เลขเดิม -R) และปลดการจับคู่", async () => {
    await diffGroup();
    await db.query(`select bank_unmatch($1,'cancel')`, [L[0]]);
    const v = await rows<any>(`select voucher_no, reverses_id from journal_vouchers where source_type='bank_diff' order by voucher_no`);
    expect(v.length).toBe(2); expect(v[1].voucher_no).toBe(v[0].voucher_no + '-R');
    const items = await rows(`select * from bank_book_items($1)`, [bank]);
    expect(items.length).toBe(1);   // เหลือแต่เอกสารโอน; JV ผลต่างและใบกลับรายการถูกตัดออก
  });
  it("'keep' คง JV ผลต่างไว้ และกลับมาเป็นรายการรอจับคู่", async () => {
    await diffGroup();
    await db.query(`select bank_unmatch($1,'keep')`, [L[0]]);
    const items = await rows<any>(`select * from bank_book_items($1) where group_id is null order by voucher_no`, [bank]);
    expect(items.length).toBe(2);
    expect(await err(db.query('select bank_unmatch($1)', [L[0]]))).toContain('ยังไม่ได้จับคู่');
  });
  it('ใบสำคัญที่จับคู่แล้วกลับรายการไม่ได้ จนกว่าจะยกเลิกจับคู่', async () => {
    const v = await post('JV', '2026-10-23', [{ account: bankCode, debit: 500 }, { account: '49010', credit: 500 }]);
    await db.query('select bank_match($1::uuid[], $2::uuid[])', [[L[0]], [await itemOf(v)]]);
    expect(await err(db.query('select reverse_voucher($1)', [v]))).toContain('RECONCILED');
    await db.query('select bank_unmatch($1)', [L[0]]);
    await db.query('select reverse_voucher($1)', [v]);
  });
  it("'cancel' ในงวดที่ล็อก ล้มทั้งธุรกรรม คู่ยังจับอยู่", async () => {
    await diffGroup();
    await db.query(`insert into period_locks(date_from,date_to,reason) values ('2026-10-21','2026-10-21','test')`);
    expect(await err(db.query(`select bank_unmatch($1,'cancel')`, [L[0]]))).toContain('PERIOD_LOCKED');
    expect((await one<any>('select matched_lines m from bank_reconcile_status($1)', [bank])).m).toBe(1);
  });
});

describe('M13 สรุปและโอนเงิน', () => {
  it('จับคู่ครบ ผลต่างเป็น 0 ยอดธนาคาร 3,675 = สมุดบัญชี 3,675', async () => {
    const a = await post('JV', '2026-10-23', [{ account: bankCode, debit: 3210 }, { account: '41210', credit: 3210 }]);
    const b = await post('JV', '2026-10-23', [{ account: bankCode, debit: 500 }, { account: '49010', credit: 500 }]);
    const c = await post('JV', '2026-10-23', [{ account: '53211', debit: 35 }, { account: bankCode, credit: 35 }]);
    for (const [l, v] of [[L[2], a], [L[0], b], [L[1], c]] as const)
      await db.query('select bank_match($1::uuid[], $2::uuid[])', [[l], [await itemOf(v)]]);
    const s = await one<any>('select * from bank_reconcile_status($1)', [bank]);
    expect([s.total_lines, s.matched_lines, +s.bank_balance, +s.book_matched, +s.diff]).toEqual([3, 3, 3675, 3675, 0]);
  });
  it('โอนเงินสด→ธนาคาร 1,000 ค่าธรรมเนียม 10 จ่ายจากต้นทาง และโผล่เป็นรายการรอจับคู่ 1,000', async () => {
    const v = (await one<{ v: string }>(
      `select bank_transfer('11112',$1,'2026-10-23'::date,1000,10) as v`, [bankCode])).v;
    expect(await entries(v)).toEqual([[bankCode, 1000, 0], ['11112', 0, 1000], ['53211', 10, 0], ['11112', 0, 10]]);
    const it2 = await rows<any>('select amount from bank_book_items($1)', [bank]);
    expect(it2.map((r: any) => +r.amount)).toEqual([1000]);
  });
  it('โอนเงิน: ปลายทาง=ต้นทาง หรือจำนวน ≤ 0 ถูกปฏิเสธ', async () => {
    expect(await err(db.query(`select bank_transfer('11112','11112','2026-10-23'::date,10)`))).toContain('ต่างกัน');
    expect(await err(db.query(`select bank_transfer('11112',$1,'2026-10-23'::date,0)`, [bankCode]))).toContain('มากกว่า 0');
  });
});
