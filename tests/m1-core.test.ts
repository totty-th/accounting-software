import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../supabase/migrations/0001_core_ledger.sql', import.meta.url), 'utf8');
let db: PGlite;

const ACCOUNTS: [string, string, string][] = [
  ['11112', 'เงินสด', 'asset'], ['11311', 'ลูกหนี้', 'asset'], ['11319', 'ใบเสร็จรอเรียกเก็บ', 'asset'],
  ['27111', 'ภาษีขาย', 'liability'], ['41210', 'รายได้', 'revenue'],
];

async function post(type: string, date: string, lines: object[]) {
  const r = await db.query<{ id: string }>(
    `select post_voucher($1,$2::date,null,null,null,$3::jsonb) as id`, [type, date, JSON.stringify(lines)]);
  return r.rows[0].id;
}
const sale = [
  { account: '11311', debit: 10700 }, { account: '41210', credit: 10000 }, { account: '27111', credit: 700 },
];
const err = async (p: Promise<unknown>) => { try { await p; return ''; } catch (e) { return (e as Error).message; } };

beforeAll(async () => { db = new PGlite(); await db.exec(sql); });
beforeEach(async () => {
  await db.exec('truncate journal_lines, journal_vouchers, period_locks, doc_sequences, accounts cascade');
  for (const [c, n, t] of ACCOUNTS) await db.query('insert into accounts(code,name,type) values ($1,$2,$3)', [c, n, t]);
});

describe('ACC-01 ลงบัญชีและเลขใบสำคัญ', () => {
  it('AT-01 ขายบริการ 10,000 + VAT 700', async () => {
    const id = await post('SV', '2026-10-15', sale);
    const v = await db.query<{ voucher_no: string }>('select voucher_no from journal_vouchers where id=$1', [id]);
    expect(v.rows[0].voucher_no).toBe('SV0001');
    const l = await db.query<{ code: string; debit: string; credit: string }>(
      `select a.code, l.debit, l.credit from journal_lines l join accounts a on a.id=l.account_id
       where voucher_id=$1 order by line_no`, [id]);
    expect(l.rows.map(r => [r.code, +r.debit, +r.credit])).toEqual([
      ['11311', 10700, 0], ['41210', 0, 10000], ['27111', 0, 700]]);
  });
  it('เลขใบสำคัญนับต่อเนื่องแยกตามประเภท', async () => {
    await post('SV', '2026-10-15', sale);
    const id2 = await post('SV', '2026-10-16', sale);
    const id3 = await post('RV', '2026-10-16', [{ account: '11112', debit: 5 }, { account: '11319', credit: 5 }]);
    const r = await db.query<{ voucher_no: string }>('select voucher_no from journal_vouchers where id = any($1)', [[id2, id3]]);
    expect(r.rows.map(x => x.voucher_no).sort()).toEqual(['RV0001', 'SV0002']);
  });
  it('เดบิตไม่เท่าเครดิต บันทึกไม่ได้ (ACC-03)', async () => {
    const m = await err(post('JV', '2026-10-15', [{ account: '11112', debit: 100 }, { account: '41210', credit: 99 }]));
    expect(m).toContain('ไม่เท่ากับ');
    expect((await db.query('select 1 from journal_vouchers')).rows).toHaveLength(0);
  });
  it('บัญชีที่ไม่มีอยู่ บันทึกไม่ได้', async () => {
    expect(await err(post('JV', '2026-10-15', [{ account: '99999', debit: 1 }, { account: '41210', credit: 1 }]))).toContain('ไม่พบบัญชี');
  });
  it('ตรวจความสมดุลที่ฐานข้อมูลด้วย แม้ insert ตรงๆ', async () => {
    const id = await post('SV', '2026-10-15', sale);
    const acc = (await db.query<{ id: string }>(`select id from accounts where code='11112'`)).rows[0].id;
    const m = await err(db.exec(`insert into journal_lines(voucher_id,line_no,account_id,debit) values ('${id}',9,'${acc}',1)`));
    expect(m).toContain('ไม่เท่ากับ');
  });
});

describe('ACC-02 ใบกลับรายการ', () => {
  it('สร้าง SV0001-R สลับเดบิต/เครดิต เก็บของเดิมไว้', async () => {
    const id = await post('SV', '2026-10-15', sale);
    const rid = await db.query<{ id: string }>('select reverse_voucher($1) as id', [id]);
    const r = await db.query<{ voucher_no: string; reverses_id: string }>(
      'select voucher_no, reverses_id from journal_vouchers where id=$1', [rid.rows[0].id]);
    expect(r.rows[0]).toEqual({ voucher_no: 'SV0001-R', reverses_id: id });
    const tb = await db.query('select * from trial_balance($1::date,$2::date,false)', ['2026-10-01', '2026-10-31']);
    expect(tb.rows).toHaveLength(3);
    for (const row of tb.rows as { closing: string }[]) expect(+row.closing).toBe(0);
  });
  it('กลับรายการซ้ำไม่ได้ และกลับรายการของใบ -R ไม่ได้', async () => {
    const id = await post('SV', '2026-10-15', sale);
    const rid = (await db.query<{ id: string }>('select reverse_voucher($1) as id', [id])).rows[0].id;
    expect(await err(db.query('select reverse_voucher($1)', [id]))).toContain('ถูกกลับรายการแล้ว');
    expect(await err(db.query('select reverse_voucher($1)', [rid]))).toContain('ไม่สามารถกลับรายการซ้ำ');
  });
  it('แก้หรือลบรายการบัญชีไม่ได้', async () => {
    const id = await post('SV', '2026-10-15', sale);
    expect(await err(db.query('update journal_vouchers set memo=$1 where id=$2', ['x', id]))).toContain('ใบกลับรายการ');
    expect(await err(db.query('delete from journal_lines where voucher_id=$1', [id]))).toContain('ใบกลับรายการ');
  });
});

describe('ACC-05 ล็อกงวด (AT-07)', () => {
  const past = (d: number) => new Date(Date.now() + 7 * 36e5 - d * 864e5).toISOString().slice(0, 10); // วันที่ตามเวลาไทย
  it('บล็อกตอนบันทึกในช่วงที่ล็อก และปลดล็อกแล้วบันทึกได้', async () => {
    const from = past(20), to = past(5), inside = past(10);
    const lock = (await db.query<{ id: string }>('select lock_period($1::date,$2::date,$3) as id', [from, to, 'ปิดงวด'])).rows[0].id;
    expect(await err(post('SV', inside, sale))).toContain('PERIOD_LOCKED');
    await db.query('select release_period_lock($1)', [lock]);
    await expect(post('SV', inside, sale)).resolves.toBeTruthy();
  });
  it('กลับรายการลงงวดที่ล็อกไม่ได้', async () => {
    const d = past(10);
    const id = await post('SV', d, sale);
    await db.query('select lock_period($1::date,$2::date,$3)', [past(20), past(5), 'ปิดงวด']);
    expect(await err(db.query('select reverse_voucher($1)', [id]))).toContain('PERIOD_LOCKED');
  });
  it('ล็อกได้ถึงเมื่อวานเท่านั้น และต้องมีเหตุผล', async () => {
    expect(await err(db.query('select lock_period($1::date,$2::date,$3)', [past(3), past(0), 'x']))).toContain('เมื่อวาน');
    expect(await err(db.query('select lock_period($1::date,$2::date,$3)', [past(3), past(2), '  ']))).toBeTruthy();
  });
});

describe('ACC-06 เลขเอกสารตามวันที่ (AT-08)', () => {
  it('prefix + yyyyMMdd + ลำดับ นับใหม่ทุกวัน', async () => {
    const n = async (d: string) => (await db.query<{ n: string }>(`select next_doc_no('INV',$1::date,true) as n`, [d])).rows[0].n;
    expect(await n('2026-10-15')).toBe('INV202610150001');
    expect(await n('2026-10-15')).toBe('INV202610150002');
    expect(await n('2026-10-16')).toBe('INV202610160001');
    expect(await n('2026-10-15')).toBe('INV202610150003');
  });
});

describe('ACC-08 งบทดลอง', () => {
  it('ยกมา / งวด / สะสม และตัดบัญชียอดศูนย์ออก', async () => {
    await post('SV', '2026-09-20', sale);
    await post('RV', '2026-10-05', [{ account: '11112', debit: 10700 }, { account: '11311', credit: 10700 }]);
    const r = await db.query<{ code: string; opening: string; period_dr: string; period_cr: string; closing: string }>(
      `select * from trial_balance('2026-10-01','2026-10-31',false)`);
    const by = Object.fromEntries(r.rows.map(x => [x.code, x]));
    expect(+by['11311'].opening).toBe(10700);
    expect(+by['11311'].period_cr).toBe(10700);
    expect(+by['11311'].closing).toBe(0);
    expect(+by['11112'].closing).toBe(10700);
    expect(by['11319']).toBeUndefined();
    const all = await db.query(`select * from trial_balance('2026-10-01','2026-10-31',true)`);
    expect(all.rows).toHaveLength(5);
    const sum = r.rows.reduce((s, x) => s + +x.closing, 0);
    expect(sum).toBe(0);
  });
});
