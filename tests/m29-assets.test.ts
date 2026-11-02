import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';

const dir = new URL('../supabase/migrations/', import.meta.url);
let db: PGlite;
let vendor: string, itCat: string;
const ACCOUNTS: [string, string, string][] = [
  ['11112', 'เงินสด', 'asset'], ['17113', 'ภาษีซื้อยังไม่ถึงกำหนด', 'asset'], ['21399', 'เจ้าหนี้อื่นๆ', 'liability'], ['53101', 'ค่าบริการ', 'expense'],
];
const err = async (p: Promise<unknown>) => { try { await p; return ''; } catch (e) { return (e as Error).message; } };
const one = async <T = any>(q: string, a: unknown[] = []) => (await db.query<any>(q, a)).rows[0] as T;
const rows = async (q: string, a: unknown[] = []) => (await db.query<any>(q, a)).rows;
const lines = async (v: string) => (await rows(`select a.code, l.debit, l.credit from journal_lines l join accounts a on a.id=l.account_id where voucher_id=$1 order by line_no`, [v]))
  .map(x => [x.code, +x.debit, +x.credit]);
const mk = async (o: Record<string, unknown> = {}) => (await one<{ id: string }>(`select create_asset($1::jsonb) id`, [JSON.stringify({
  name: 'โน๊ตบุ๊ก', category_id: itCat, purchase_date: '2026-11-01', cost: 36001, ...o })])).id;
const activeDep = (ym: string) => one<any>(`select v.id, v.voucher_no, (select sum(debit) from journal_lines where voucher_id = v.id) amt from journal_vouchers v
  where source_type='DEP' and source_id=$1 and reverses_id is null and not exists (select 1 from journal_vouchers r where r.reverses_id = v.id)`, [ym]);

beforeAll(async () => {
  db = new PGlite();
  for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(new URL(f, dir), 'utf8'));
});
beforeEach(async () => {
  await db.exec(`truncate fixed_assets, expense_lines, expenses, wht_certs, contacts, journal_lines, journal_vouchers, period_locks, doc_sequences, accounts cascade`);
  for (const [c, n, t] of ACCOUNTS) await db.query('insert into accounts(code,name,type) values ($1,$2,$3)', [c, n, t]);
  vendor = (await one<{ id: string }>(`insert into contacts(business_name) values ('ผู้ขาย') returning id`)).id;
  itCat = (await one<{ id: string }>(`select id from asset_categories where name = 'คอมพิวเตอร์/อุปกรณ์ไอที'`)).id;
});

describe('M29 สูตรค่าเสื่อม (ตามที่ทดสอบบน FA)', () => {
  it('อัตราปัด 2 ตำแหน่ง · ค่าเสื่อม/ปี = 11,998.80 ไม่ใช่ 12,000', async () => {
    const id = await mk();
    const r = await one<any>(`select asset_rate(life_years) rate, asset_annual(a) annual from fixed_assets a where id=$1`, [id]);
    expect(+r.rate).toBe(33.33); expect(+r.annual).toBe(11998.8);
  });
  it('61 วัน = 2,005.28 · พ.ย. 30 วัน 986.20 · ธ.ค. 31 วัน 1,019.08 รวมเท่ากัน', async () => {
    const id = await mk();
    const p = (f: string, t: string) => one<any>(`select asset_dep_period(a, $2::date, $3::date) v, asset_dep_days(a, $2::date, $3::date) d from fixed_assets a where id=$1`, [id, f, t]);
    expect(+(await p('2026-11-01', '2026-12-31')).v).toBe(2005.28);
    expect((await p('2026-11-01', '2026-12-31')).d).toBe(61);
    expect(+(await p('2026-11-01', '2026-11-30')).v).toBe(986.2);
    expect(+(await p('2026-12-01', '2026-12-31')).v).toBe(1019.08);
  });
  it('ค่าเสื่อมไม่เกินมูลค่าที่คิดค่าเสื่อม และก่อนวันเริ่มคำนวณเป็นศูนย์', async () => {
    const id = await mk({ cost: 3001, life_years: 1 });
    expect(+(await one<any>(`select asset_dep_cum(a, '2030-01-01') v from fixed_assets a where id=$1`, [id])).v).toBe(3000);
    expect(+(await one<any>(`select asset_dep_cum(a, '2026-10-31') v from fixed_assets a where id=$1`, [id])).v).toBe(0);
  });
  it('ตรวจฟอร์ม: วันเริ่มคำนวณก่อนวันเริ่มใช้ / ซากเกินราคา / ไม่มีชื่อ', async () => {
    expect(await err(mk({ calc_start: '2026-10-01' }))).toMatch(/วันเริ่มคำนวณ/);
    expect(await err(mk({ salvage: 40000 }))).toMatch(/มูลค่าซาก/);
    expect(await err(mk({ name: ' ' }))).toMatch(/ชื่อสินทรัพย์/);
  });
  it('ค่าเสื่อมสะสมยกมา: ไม่นับซ้ำในงวด และหักจากมูลค่าที่คิดได้', async () => {
    const id = await mk({ accum_open: 10000, start_date: '2026-01-01', purchase_date: '2026-01-01', calc_start: '2026-11-01' });
    expect(+(await one<any>(`select asset_accum_at(a, '2026-11-30') v from fixed_assets a where id=$1`, [id])).v).toBe(10986.2);
  });
});

describe('M29 ลงบัญชีค่าเสื่อมรายเดือน', () => {
  it('ลงทั้งปี: เฉพาะเดือนที่มียอด JV วันสิ้นเดือน Dr 58612 / Cr 18612 · ทำซ้ำไม่เกิดใบใหม่', async () => {
    await mk();
    expect(await one<any>(`select post_asset_depreciation(2026) n`)).toEqual({ n: 2 });
    const nov = await activeDep('2026-11'), dec = await activeDep('2026-12');
    expect(+nov.amt).toBe(986.2); expect(+dec.amt).toBe(1019.08);
    expect((await lines(nov.id)).sort()).toEqual([['18612', 0, 986.2], ['58612', 986.2, 0]]);
    const v = await one<any>(`select voucher_date::text d, voucher_type t, memo from journal_vouchers where id=$1`, [nov.id]);
    expect(v.d).toBe('2026-11-30'); expect(v.t).toBe('JV'); expect(v.memo).toBe('บันทึกรายการค่าเสื่อมสำหรับงวด 11-2026');
    expect(await one<any>(`select post_asset_depreciation(2026) n`)).toEqual({ n: 0 });
    expect((await activeDep('2026-11')).id).toBe(nov.id);
  });
  it('แผนรายเดือน: ยอดที่ควรเป็น = ยอดที่ลงแล้ว', async () => {
    await mk(); await db.query(`select post_asset_depreciation(2026)`);
    const p = await rows(`select * from asset_dep_plan(2026)`);
    expect(p).toHaveLength(12);
    expect(+p[10].expected).toBe(986.2); expect(+p[10].posted).toBe(986.2); expect(+p[0].expected).toBe(0); expect(p[0].voucher_id).toBeNull();
  });
  it('เปลี่ยนอายุใช้งานหลังลงบัญชี → กลับรายการ -R แล้วลงใหม่ที่เลขใหม่', async () => {
    const id = await mk(); await db.query(`select post_asset_depreciation(2026)`);
    const old = await activeDep('2026-11');
    await db.query(`select update_asset($1, $2::jsonb)`, [id, JSON.stringify({ category_id: itCat, name: 'โน๊ตบุ๊ก', life_years: 5, salvage: 1, start_date: '2026-11-01', calc_start: '2026-11-01' })]);
    const nw = await activeDep('2026-11');
    expect(nw.id).not.toBe(old.id); expect(+nw.amt).toBe(round2(36000 * 0.2 * 30 / 365));
    const rev = await one<any>(`select voucher_no from journal_vouchers where reverses_id = $1`, [old.id]);
    expect(rev.voucher_no).toBe(old.voucher_no + '-R');
  });
  it('แต่ละเดือนที่ล็อกงวดแล้ว ห้ามลงใหม่เมื่อยอดเปลี่ยน', async () => {
    const id = await mk(); await db.query(`select post_asset_depreciation(2026)`);
    await db.query(`insert into period_locks(date_from,date_to,reason) values ('2026-11-01','2026-11-30','ทดสอบ')`);
    expect(await err(db.query(`select update_asset($1, $2::jsonb)`, [id, JSON.stringify({ category_id: itCat, name: 'x', life_years: 5, salvage: 1, start_date: '2026-11-01' })]))).toMatch(/PERIOD_LOCKED|ล็อก/);
  });
});
const round2 = (n: number) => Math.round(n * 100) / 100;

describe('M29 เลิกใช้สินทรัพย์', () => {
  it('ขาย 20,000 วันที่ 1 พ.ย.: เหมือนที่ FA ลงบัญชี + ค่าเสื่อมถูกคำนวณใหม่เหลือ 1 วัน', async () => {
    const id = await mk({ code: 'TEST-AS-001' }); await db.query(`select post_asset_depreciation(2026)`);
    const v = (await one<any>(`select dispose_asset($1,'2026-11-01','sold',20000) v`, [id])).v;
    expect(await lines(v)).toEqual([['18612', 32.87, 0], ['49990', 20000, 0], ['49880', 15968.13, 0], ['12612', 0, 36001]]);
    const a = await one<any>(`select status, disposed_date::text d, sale_price from fixed_assets where id=$1`, [id]);
    expect(a.status).toBe('sold'); expect(a.d).toBe('2026-11-01');
    expect(+(await activeDep('2026-11')).amt).toBe(32.87);
    expect(await activeDep('2026-12')).toBeUndefined();
    expect(await one<any>(`select count(*)::int n from journal_vouchers where source_type='DEP' and reverses_id is not null`)).toEqual({ n: 2 });
    expect(await err(db.query(`select dispose_asset($1,'2026-11-02','sold',1)`, [id]))).toMatch(/เลิกใช้งานไม่ได้/);
  });
  it('ขายได้กำไร: 49880 เครดิต · งบการเงินสมดุล', async () => {
    const id = await mk(); const v = (await one<any>(`select dispose_asset($1,'2027-11-01','sold',30000) v`, [id])).v;
    const l = await lines(v);
    const accum = l[0][1] as number; expect(l[2][0]).toBe('49880'); expect(l[2][2]).toBe(round2(30000 - (36001 - accum)));
    expect(await one<any>(`select sum(debit)=sum(credit) ok from journal_lines`)).toEqual({ ok: true });
  });
  it('บริจาค/ทำลาย (ยังไม่ทดสอบบน FA): ไม่มีราคาขาย ตัดมูลค่าคงเหลือเป็นขาดทุน', async () => {
    const id = await mk(); const v = (await one<any>(`select dispose_asset($1,'2026-11-01','destroyed') v`, [id])).v;
    expect(await lines(v)).toEqual([['18612', 32.87, 0], ['49880', 35968.13, 0], ['12612', 0, 36001]]);
    expect((await one<any>(`select status from fixed_assets where id=$1`, [id])).status).toBe('disposed');
  });
  it('ย้อนสถานะ: กลับรายการใบตัดสินทรัพย์ -R และค่าเสื่อมกลับมา', async () => {
    const id = await mk(); await db.query(`select post_asset_depreciation(2026)`);
    const v = (await one<any>(`select dispose_asset($1,'2026-11-01','sold',20000) v`, [id])).v;
    await db.query(`select reopen_asset($1)`, [id]);
    expect((await one<any>(`select status from fixed_assets where id=$1`, [id])).status).toBe('in_use');
    expect(+(await activeDep('2026-11')).amt).toBe(986.2); expect(+(await activeDep('2026-12')).amt).toBe(1019.08);
    expect((await one<any>(`select voucher_no from journal_vouchers where reverses_id=$1`, [v])).voucher_no).toMatch(/-R$/);
  });
  it('พักการใช้งาน ⇄ ใช้งานอยู่ · ลบได้เฉพาะสินทรัพย์ยกมา', async () => {
    const id = await mk(); await db.query(`select set_asset_status($1,'suspended')`, [id]);
    expect((await one<any>(`select status from fixed_assets where id=$1`, [id])).status).toBe('suspended');
    await db.query(`select set_asset_status($1,'in_use')`, [id]);
    expect(await err(db.query(`select set_asset_status($1,'sold')`, [id]))).toMatch(/เปลี่ยนสถานะได้เฉพาะ/);
    await db.query(`select delete_asset($1)`, [id]);
    expect((await one<any>(`select count(*)::int n from fixed_assets`)).n).toBe(0);
  });
});

describe('M29 เทียบ FA: บริจาค/พักใช้งาน/ไม่คิดค่าเสื่อม', () => {
  it('ที่ดิน (ไม่คิดค่าเสื่อม) บริจาค → Dr 49880 / Cr สินทรัพย์ ที่ราคาทุน', async () => {
    const id = await mk({ depreciate: false, cost: 500000 });
    const v = (await one<any>(`select dispose_asset($1,'2026-11-02','donated',0) v`, [id])).v;
    const l = await lines(v);
    expect(l.length).toBe(2);
    expect(l.map((x: any[]) => x.slice(1))).toEqual([[500000, 0], [0, 500000]]);
    expect(l[0][0]).toBe('49880');
  });
  it('พักการใช้งานยังคิดค่าเสื่อมต่อ (FA ทดสอบแล้ว)', async () => {
    const id = await mk(); const q = `select asset_dep_period(a,'2026-11-01','2026-11-30') v from fixed_assets a where id=$1`;
    const before = +(await one<any>(q, [id])).v;
    await db.query(`select set_asset_status($1,'suspended')`, [id]);
    expect(+(await one<any>(q, [id])).v).toBe(before);
  });
});

describe('M29 อายุตั้งต้นของหมวด (ตาม FA)', () => {
  it('ไอที 3 ปี · ซอฟต์แวร์ 10 ปี · อื่นๆ 5 ปี', async () => {
    const r = await rows(`select name, life_years from asset_categories`);
    const m = Object.fromEntries(r.map((x: any) => [x.name, +x.life_years]));
    expect(m['คอมพิวเตอร์/อุปกรณ์ไอที']).toBe(3); expect(m['ซอฟต์แวร์คอมพิวเตอร์']).toBe(10);
    expect(m['ยานพาหนะ']).toBe(5); expect(m['เฟอร์นิเจอร์/อุปกรณ์สำนักงาน']).toBe(5);
  });
});

describe('M29 สร้างจากค่าใช้จ่าย', () => {
  const exp = async (extra: Record<string, unknown> = {}) => (await one<{ id: string }>(`select save_expense($1::jsonb, $2::jsonb) id`, [
    JSON.stringify({ date: '2026-11-01', contact: vendor }),
    JSON.stringify([{ description: 'โน๊ตบุ๊ก', qty: 1, unit_price: 18000, vat: '7', asset_category: itCat, ...extra }, { description: 'ค่าบริการ', account: '53101', qty: 1, unit_price: 100, vat: '0' }])])).id;
  it('บรรทัดหมวดสินทรัพย์ → ลงบัญชี 12612 และสร้างสินทรัพย์ราคาก่อน VAT ผูกเอกสาร', async () => {
    const id = await exp();
    const a = await one<any>(`select * from fixed_assets where expense_id=$1`, [id]);
    expect(+a.cost).toBe(18000); expect(a.name).toBe('โน๊ตบุ๊ก'); expect(a.vendor).toBe('ผู้ขาย'); expect(a.status).toBe('in_use');
    expect(a.ref_no).toMatch(/^EXP20261101/); expect(a.code).toMatch(/^AS\d{4}$/); expect(a.start_date.toISOString().slice(0, 10)).toBe('2026-11-01');
    const e = await one<any>(`select uv_voucher_id v from expenses where id=$1`, [id]);
    expect(await lines(e.v)).toEqual([['12612', 18000, 0], ['53101', 100, 0], ['17113', 1260, 0], ['21399', 0, 19360]]);
    expect(await err(db.query(`select delete_asset($1)`, [a.id]))).toMatch(/สร้างจากเอกสารค่าใช้จ่าย/);
  });
  it('แก้สินทรัพย์จากค่าใช้จ่าย: ชื่อ/ราคาไม่เปลี่ยน แต่ปรับอายุ/ที่ตั้งได้', async () => {
    const id = await exp(); const a = await one<any>(`select id, life_years from fixed_assets where expense_id=$1`, [id]);
    await db.query(`select update_asset($1,$2::jsonb)`, [a.id, JSON.stringify({ category_id: itCat, name: 'เปลี่ยนชื่อ', cost: 1, life_years: 4, location: 'ห้อง A', salvage: 1 })]);
    const r = await one<any>(`select name, cost, life_years, location from fixed_assets where id=$1`, [a.id]);
    expect(r.name).toBe('โน๊ตบุ๊ก'); expect(+r.cost).toBe(18000); expect(+r.life_years).toBe(4); expect(r.location).toBe('ห้อง A');
  });
  it('ยกเลิกค่าใช้จ่าย → สินทรัพย์ยกเลิก ค่าเสื่อมที่ลงไว้ถูกกลับรายการ', async () => {
    const id = await exp(); await db.query(`select post_asset_depreciation(2026)`);
    expect(await activeDep('2026-11')).toBeTruthy();
    await db.query(`select cancel_expense($1)`, [id]);
    expect((await one<any>(`select status from fixed_assets where expense_id=$1`, [id])).status).toBe('void');
    expect(await activeDep('2026-11')).toBeUndefined();
  });
  it('ขายสินทรัพย์แล้วยกเลิกเอกสารค่าใช้จ่ายไม่ได้', async () => {
    const id = await exp(); const a = await one<any>(`select id from fixed_assets where expense_id=$1`, [id]);
    await db.query(`select dispose_asset($1,'2026-11-05','sold',5000)`, [a.id]);
    expect(await err(db.query(`select cancel_expense($1)`, [id]))).toMatch(/เลิกใช้งานแล้ว/);
  });
});

describe('M29 หมวดหมู่', () => {
  it('หมวดเริ่มต้น 6 หมวด · สร้างหมวดใหม่ได้ · ต้องมีบัญชีครบเมื่อคิดค่าเสื่อม', async () => {
    expect((await one<any>(`select count(*)::int n from asset_categories`)).n).toBe(6);
    const id = (await one<any>(`select save_asset_category(null,$1::jsonb) id`, [JSON.stringify({ name: 'เครื่องจักร', life_years: 10, asset_account: '12620', dep_account: '58620', accum_account: '18620' })])).id;
    expect((await one<any>(`select code from accounts where code='12620'`)).code).toBe('12620');
    expect(+(await one<any>(`select life_years from asset_categories where id=$1`, [id])).life_years).toBe(10);
    expect(await err(db.query(`select save_asset_category(null,$1::jsonb)`, [JSON.stringify({ name: 'ผิด', life_years: 3, asset_account: '12620' })]))).toMatch(/บัญชีค่าเสื่อม/);
  });
});
