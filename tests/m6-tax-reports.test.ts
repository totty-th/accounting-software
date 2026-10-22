import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';

const dir = new URL('../supabase/migrations/', import.meta.url);
let db: PGlite;
const ACCOUNTS: [string, string, string][] = [
  ['11112', 'เงินสด', 'asset'], ['11311', 'ลูกหนี้', 'asset'], ['12612', 'คอมพิวเตอร์', 'asset'],
  ['17111', 'ภาษีซื้อ ภ.พ.30', 'asset'], ['17113', 'ภาษีซื้อยังไม่ถึงกำหนด', 'asset'], ['17114', 'ภาษีมูลค่าเพิ่มรอขอคืน', 'asset'],
  ['21399', 'เจ้าหนี้อื่นๆ', 'liability'], ['27111', 'ภาษีขาย', 'liability'], ['27140', 'เจ้าหนี้สรรพากร', 'liability'],
  ['31000', 'ทุน', 'equity'], ['32000', 'กำไรสะสม', 'equity'],
  ['41210', 'รายได้บริการ', 'revenue'], ['53101', 'ค่าบริการ', 'expense'],
];
const err = async (p: Promise<unknown>) => { try { await p; return ''; } catch (e) { return (e as Error).message; } };
const one = async <T = any>(q: string, a: unknown[] = []) => (await db.query<any>(q, a)).rows[0] as T;
const call = (q: string, a: unknown[] = []) => db.query(q, a);
const post = (type: string, date: string, lines: object[]) =>
  one<{ id: string }>(`select post_voucher($1,$2::date,null,null,null,$3::jsonb) id`, [type, date, JSON.stringify(lines)]).then(x => x.id);
async function entries(v: string) {
  const r = await db.query<any>(`select a.code, l.debit, l.credit from journal_lines l join accounts a on a.id=l.account_id
    where voucher_id=$1 order by line_no`, [v]);
  return r.rows.map(x => [x.code, +x.debit, +x.credit]);
}
const filing = (id: string) => one('select * from pp30_filings where id=$1', [id]);
const reversals = async () =>
  (await db.query<any>(`select voucher_no from journal_vouchers where voucher_no like '%-R' order by voucher_no`)).rows.map(x => x.voucher_no);
const nV = async () => +(await one<any>('select count(*) c from journal_vouchers')).c;
const r2 = (x: number) => Math.round(x * 100) / 100;
const sale = (date: string, net: number) => post('SV', date, [
  { account: '11311', debit: r2(net * 1.07) }, { account: '41210', credit: net }, { account: '27111', credit: r2(net * 0.07) }]);
const buy = (date: string, net: number) => post('UV', date, [
  { account: '12612', debit: net }, { account: '17113', debit: r2(net * 0.07) }, { account: '21399', credit: r2(net * 1.07) }]);

beforeAll(async () => {
  db = new PGlite();
  for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(new URL(f, dir), 'utf8'));
});
beforeEach(async () => {
  await db.exec(`truncate year_closes, pp30_filings, journal_lines, journal_vouchers, period_locks, doc_sequences, accounts cascade`);
  for (const [c, n, t] of ACCOUNTS) await db.query('insert into accounts(code,name,type) values ($1,$2,$3)', [c, n, t]);
});

describe('TAX ภ.พ.30 (AT-11)', () => {
  it('กรณีต้องชำระ: JV Dr 27111 / Cr 27140 ลงวันที่สิ้นเดือน · ชำระ PV · รีเซ็ต PV-R', async () => {
    await sale('2026-10-10', 10000);
    const id = await one<{ id: string }>(`select file_pp30('2026-10-01') id`).then(x => x.id);
    const f = await filing(id);
    expect([f.result, +f.output_vat, +f.input_vat, +f.amount]).toEqual(['payable', 700, 0, 700]);
    expect(f.uv_voucher_id).toBeNull();
    expect(await entries(f.jv_voucher_id)).toEqual([['27111', 700, 0], ['27140', 0, 700]]);
    expect((await one<any>('select voucher_date d from journal_vouchers where id=$1', [f.jv_voucher_id])).d.toISOString().slice(0, 10)).toBe('2026-10-31');
    const pv = (await one<any>(`select pay_pp30($1,'2026-11-05'::date) v`, [id])).v;
    expect(await entries(pv)).toEqual([['27140', 700, 0], ['11112', 0, 700]]);
    expect(await err(call(`select pay_pp30($1,'2026-11-05'::date)`, [id]))).toContain('ชำระแล้ว');
    await call('select reset_pp30_payment($1)', [id]);
    expect(await reversals()).toEqual(['PV0001-R']);
    expect((await filing(id)).pv_voucher_id).toBeNull();
  });
  it('กรณีขอคืน: UV Dr 17111 / Cr 17113, JV Dr 17114 / Cr 17111 · บันทึก/รีเซ็ตขอคืนไม่มีรายการบัญชี', async () => {
    await buy('2026-10-10', 30000);
    const id = (await one<any>(`select file_pp30('2026-10-01') id`)).id;
    const f = await filing(id);
    expect([f.result, +f.amount]).toEqual(['refund', 2100]);
    expect(await entries(f.uv_voucher_id)).toEqual([['17111', 2100, 0], ['17113', 0, 2100]]);
    expect(await entries(f.jv_voucher_id)).toEqual([['17114', 2100, 0], ['17111', 0, 2100]]);
    const n = await nV();
    await call('select set_pp30_refund($1,true)', [id]); await call('select set_pp30_refund($1,false)', [id]);
    expect(await nV()).toBe(n);
    expect(await err(call('select pay_pp30($1,$2::date)', [id, '2026-11-05']))).toContain('ต้องชำระ');
  });
  it('มีทั้งภาษีขายและภาษีซื้อ: หักกลบเหลือยอดสุทธิ และบัญชีภาษีของเดือนเป็นศูนย์', async () => {
    await sale('2026-10-10', 10000); await buy('2026-10-12', 4000);
    const id = (await one<any>(`select file_pp30('2026-10-01') id`)).id;
    const f = await filing(id);
    expect([f.result, +f.output_vat, +f.input_vat, +f.amount]).toEqual(['payable', 700, 280, 420]);
    const bal = async (c: string) => +(await one<any>(`select coalesce(sum(closing),0) c from trial_balance('2026-10-01','2026-10-31',false) where code=$1`, [c])).c;
    expect([await bal('27111'), await bal('17113'), await bal('17111'), await bal('27140')]).toEqual([0, 0, 0, -420]);
  });
  it('ยื่นซ้ำเดือนเดียวกันไม่ได้ · เดือนที่ไม่มีภาษีไม่เกิดรายการบัญชี', async () => {
    await sale('2026-10-10', 1000);
    await call(`select file_pp30('2026-10-01')`);
    expect(await err(call(`select file_pp30('2026-10-15')`))).toContain('ยื่นแล้ว');
    const n = await nV();
    const z = (await one<any>(`select file_pp30('2026-09-01') id`)).id;
    expect((await filing(z)).result).toBe('zero');
    expect(await nV()).toBe(n);
  });
  it('D-05 ลบแบบ: UV/JV ได้ -R (ไม่หายเงียบ) · ต้องรีเซ็ตการชำระก่อน · ยื่นใหม่ได้', async () => {
    await sale('2026-10-10', 10000); await buy('2026-10-12', 4000);
    const id = (await one<any>(`select file_pp30('2026-10-01') id`)).id;
    await call(`select pay_pp30($1,'2026-11-05'::date)`, [id]);
    expect(await err(call('select delete_pp30($1)', [id]))).toContain('รีเซ็ตการชำระ');
    await call('select reset_pp30_payment($1)', [id]);
    await call('select delete_pp30($1)', [id]);
    expect(await reversals()).toEqual(['JV0001-R', 'PV0001-R', 'UV0002-R']);
    expect((await filing(id)).status).toBe('deleted');
    const again = (await one<any>(`select file_pp30('2026-10-01') id`)).id;
    expect(+(await filing(again)).amount).toBe(420);   // ไม่นับรายการของแบบเก่าซ้ำ
  });
  it('เดือนที่ล็อกงวด: ยื่นแบบไม่ได้และไม่เหลือแบบค้าง', async () => {
    await sale('2026-09-10', 1000);
    const past = (d: number) => new Date(Date.now() + 7 * 36e5 - d * 864e5).toISOString().slice(0, 10);
    await call('select lock_period($1::date,$2::date,$3)', ['2026-09-01', past(1), 'ปิดงวด']);
    expect(await err(call(`select file_pp30('2026-09-01')`))).toContain('PERIOD_LOCKED');
    expect(+(await one<any>('select count(*) c from pp30_filings')).c).toBe(0);
  });
});

describe('ACC-09 รายงาน', () => {
  const seed = async () => {
    await post('JV', '2026-10-01', [{ account: '11112', debit: 100000 }, { account: '31000', credit: 100000 }]);
    await sale('2026-10-10', 10000);                      // รายได้ 10,000
    await post('PV', '2026-10-20', [{ account: '53101', debit: 3000 }, { account: '11112', credit: 3000 }]);
  };
  it('งบกำไรขาดทุน: รายได้ 10,000 − ค่าใช้จ่าย 3,000 = กำไร 7,000', async () => {
    await seed();
    const r = (await db.query<any>(`select * from income_statement('2026-10-01','2026-10-31')`)).rows.map(x => [x.section, x.code, +x.amount]);
    expect(r).toEqual([['revenue', '41210', 10000], ['expense', '53101', 3000]]);
    expect(+(await one<any>(`select net_profit('2026-10-01','2026-10-31') p`)).p).toBe(7000);
  });
  it('งบฐานะการเงินสมดุล: สินทรัพย์ = หนี้สิน + ส่วนของเจ้าของ (รวมกำไรงวดนี้)', async () => {
    await seed();
    const rows = (await db.query<any>(`select * from balance_sheet('2026-10-31')`)).rows;
    const sum = (s: string) => rows.filter((x: any) => x.section === s).reduce((t: number, x: any) => t + +x.amount, 0);
    expect(sum('asset')).toBeCloseTo(100000 - 3000 + 10700, 2);
    expect(sum('liability')).toBe(700);
    expect(sum('equity')).toBe(107000);
    expect(sum('asset')).toBeCloseTo(sum('liability') + sum('equity'), 2);
    expect(rows.find((x: any) => x.name.startsWith('กำไร'))!.amount).toBe('7000.00');
  });
  it('บัญชีแยกประเภท: ยอดยกมาและยอดคงเหลือสะสม', async () => {
    await seed();
    const r = (await db.query<any>(`select * from account_ledger('11112','2026-10-15','2026-10-31')`)).rows;
    expect(r.map((x: any) => [x.voucher_no, +x.debit, +x.credit, +x.balance])).toEqual([
      ['ยอดยกมา', 0, 0, 100000], ['PV0001', 0, 3000, 97000]]);
  });
});

describe('ACC-04 ปิดงวดปี', () => {
  it('CP โอนรายได้/ค่าใช้จ่ายเข้ากำไรสะสม · P&L ไม่รวม CP · งบฐานะการเงินยังสมดุล', async () => {
    await sale('2026-10-10', 10000);
    await post('PV', '2026-10-20', [{ account: '53101', debit: 3000 }, { account: '11112', credit: 3000 }]);
    const v = (await one<any>('select close_year(2026) v')).v;
    expect(await entries(v)).toEqual([['41210', 10000, 0], ['53101', 0, 3000], ['32000', 0, 7000]]);
    expect((await one<any>('select voucher_no n from journal_vouchers where id=$1', [v])).n).toBe('CP0001');
    expect(+(await one<any>(`select net_profit('2026-01-01','2026-12-31') p`)).p).toBe(7000);
    const rows = (await db.query<any>(`select * from balance_sheet('2026-12-31')`)).rows;
    const sum = (s: string) => rows.filter((x: any) => x.section === s).reduce((t: number, x: any) => t + +x.amount, 0);
    expect(sum('asset')).toBeCloseTo(sum('liability') + sum('equity'), 2);
    expect(await err(call('select close_year(2026)'))).toContain('ปิดงวดแล้ว');
  });
  it('รีเซ็ต → CP0001-R แล้วปิดใหม่ได้ (CP0002) · ปีที่ไม่มีรายการปิดไม่ได้', async () => {
    await sale('2026-10-10', 10000);
    await call('select close_year(2026)');
    await call('select reset_year_close(2026)');
    expect(await reversals()).toEqual(['CP0001-R']);
    expect((await one<any>('select voucher_no n from journal_vouchers where id=$1', [(await one<any>('select close_year(2026) v')).v])).n).toBe('CP0002');
    expect(await err(call('select close_year(2024)'))).toContain('ไม่มีรายการ');
    expect(await err(call('select reset_year_close(2025)'))).toContain('ยังไม่ได้ปิดงวด');
  });
});
