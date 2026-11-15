import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';

// ทดสอบค่าเสื่อมราคาครบวงจร: บันทึก → ลงบัญชี → ดูในรายงาน (งบกำไรขาดทุน / งบทดลอง / บัญชีแยกประเภท)
const dir = new URL('../supabase/migrations/', import.meta.url);
let db: PGlite; let itCat: string, machCat: string;
const one = async <T = any>(q: string, a: unknown[] = []) => (await db.query<any>(q, a)).rows[0] as T;
const rows = async (q: string, a: unknown[] = []) => (await db.query<any>(q, a)).rows;
const mk = async (o: Record<string, unknown>) => (await one<{ id: string }>(`select create_asset($1::jsonb) id`, [JSON.stringify(o)])).id;

beforeAll(async () => {
  db = new PGlite();
  for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(new URL(f, dir), 'utf8'));
});
beforeEach(async () => {
  await db.exec(`truncate fixed_assets, expense_lines, expenses, journal_lines, journal_vouchers, period_locks, doc_sequences, accounts cascade`);
  itCat = (await one<{ id: string }>(`select id from asset_categories where name = 'คอมพิวเตอร์/อุปกรณ์ไอที'`)).id;
  machCat = (await one<{ id: string }>(`select id from asset_categories where life_years = 5 limit 1`)).id;
});

describe('ค่าเสื่อมราคา: บันทึกแล้วดูในรายงานค่าใช้จ่าย', () => {
  it('ลงบัญชีทั้งปี → งบทดลอง/บัญชีแยกประเภท/งบกำไรขาดทุนเห็นค่าเสื่อมตรงกับตารางคำนวณ', async () => {
    await mk({ name: 'โน๊ตบุ๊ก', category_id: itCat, purchase_date: '2026-11-01', cost: 36001 });
    await mk({ name: 'เครื่องมือ', category_id: machCat, purchase_date: '2026-01-01', cost: 120000 });
    const calc = +(await one<any>(`select coalesce(sum(asset_dep_period(a,'2026-01-01','2026-12-31')),0) s from fixed_assets a`)).s;
    expect(calc).toBeGreaterThan(0);
    const n = (await one<any>(`select post_asset_depreciation(2026) n`)).n;
    expect(n).toBe(12);
    // งบทดลอง: เดบิตค่าเสื่อม (58612) = เครดิตค่าเสื่อมสะสม (18612) = ยอดตารางคำนวณ
    const tb = await rows(`select * from trial_balance('2026-01-01','2026-12-31')`);
    const exp = tb.filter(r => r.code.startsWith('58')), acc = tb.filter(r => r.code.startsWith('18'));
    expect(exp.reduce((s, r) => s + +r.period_dr, 0)).toBeCloseTo(calc, 2);
    expect(acc.reduce((s, r) => s + +r.period_cr, 0)).toBeCloseTo(calc, 2);
    // บัญชีแยกประเภท 58612: ทีละเดือน 12 รายการ ยอดรวมตรง
    const led = await rows(`select * from account_ledger('58612','2026-01-01','2026-12-31')`);
    expect(led.length).toBeGreaterThanOrEqual(2);
    expect(led.reduce((s, r) => s + +r.debit, 0)).toBeCloseTo(+exp.find(r => r.code === '58612')!.period_dr, 2);
    // งบกำไรขาดทุน: ค่าเสื่อมเป็นค่าใช้จ่าย ทำให้กำไรสุทธิติดลบเท่ายอดค่าเสื่อม (ไม่มีรายได้)
    expect(+(await one<any>(`select net_profit('2026-01-01','2026-12-31') p`)).p).toBeCloseTo(-calc, 2);
    const is = await rows(`select * from income_statement('2026-01-01','2026-12-31')`);
    expect(is.some(r => /เสื่อม/.test(r.name ?? r.account_name ?? ''))).toBe(true);
  });

  it('ดูรายเดือน: ช่วงที่ไม่มีค่าเสื่อมต้องเป็น 0 และไม่ลงใบว่าง', async () => {
    await mk({ name: 'โน๊ตบุ๊ก', category_id: itCat, purchase_date: '2026-11-01', cost: 36001 });
    await db.query(`select post_asset_depreciation(2026)`);
    expect(+(await one<any>(`select net_profit('2026-01-01','2026-10-31') p`)).p).toBe(0);
    expect(+(await one<any>(`select net_profit('2026-11-01','2026-11-30') p`)).p).toBeCloseTo(-986.2, 2);
    expect(+(await one<any>(`select count(*) c from journal_vouchers where source_type='DEP'`)).c).toBe(2);
  });

  it('เปลี่ยนอายุหลังลงบัญชี → รายงานยอดสุทธิ = ยอดใหม่ (ใบเดิมถูกกลับรายการ ไม่นับซ้ำ)', async () => {
    const id = await mk({ name: 'โน๊ตบุ๊ก', category_id: itCat, purchase_date: '2026-11-01', cost: 36001 });
    await db.query(`select post_asset_depreciation(2026)`);
    await db.query(`select update_asset($1, $2::jsonb)`, [id, JSON.stringify({ life_years: 5 })]);
    await db.query(`select post_asset_depreciation(2026)`);
    const calc = +(await one<any>(`select sum(asset_dep_period(a,'2026-01-01','2026-12-31')) s from fixed_assets a`)).s;
    expect(+(await one<any>(`select net_profit('2026-01-01','2026-12-31') p`)).p).toBeCloseTo(-calc, 2);
    const tb = await one<any>(`select sum(period_dr) d, sum(period_cr) c from trial_balance('2026-01-01','2026-12-31')`);
    expect(+tb.d).toBeCloseTo(+tb.c, 2);
  });

  it('ขายสินทรัพย์กลางปี: ค่าเสื่อมหยุดตามวันขาย และงบทดลองสมดุล', async () => {
    const id = await mk({ name: 'เครื่องมือ', category_id: machCat, purchase_date: '2026-01-01', cost: 120000 });
    await db.query(`select dispose_asset($1,'2026-06-30','sold',50000)`, [id]);
    await db.query(`select post_asset_depreciation(2026)`);
    const dep = +(await one<any>(`select asset_dep_period(a,'2026-01-01','2026-12-31') s from fixed_assets a where a.id=$1`, [id])).s;
    const posted = +(await one<any>(`select coalesce(sum(l.debit),0) s from journal_lines l join journal_vouchers v on v.id=l.voucher_id join accounts a on a.id=l.account_id
      where v.source_type='DEP' and a.code like '58%'`)).s;
    expect(posted).toBeCloseTo(dep, 2);
    expect((await rows(`select 1 from journal_vouchers where source_type='DEP' and voucher_date > '2026-06-30'`)).length).toBe(0);
    const tb = await one<any>(`select sum(period_dr) d, sum(period_cr) c from trial_balance('2026-01-01','2026-12-31')`);
    expect(+tb.d).toBeCloseTo(+tb.c, 2);
  });
});
