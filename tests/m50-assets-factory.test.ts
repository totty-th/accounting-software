import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { COA } from '../web/lib/seed';

// ทดลองใช้โมดูลสินทรัพย์กับโรงงานผลิต-ขายตะแกรง (ข้อมูลจำลอง ไม่แตะ production)
const dir = new URL('../supabase/migrations/', import.meta.url);
let db: PGlite;
const J = JSON.stringify;
const one = async <T = any>(q: string, a: unknown[] = []) => (await db.query<any>(q, a)).rows[0] as T;
const rows = async (q: string, a: unknown[] = []) => (await db.query<any>(q, a)).rows;
const err = async (p: Promise<unknown>) => { try { await p; return ''; } catch (e) { return (e as Error).message; } };
const cat = async (name: string) => (await one<any>('select id from asset_categories where name=$1', [name])).id;
const mkCat = async (d: Record<string, unknown>) => (await one<any>('select save_asset_category(null,$1::jsonb) id', [J(d)])).id;
const mk = async (d: Record<string, unknown>) => (await one<any>('select create_asset($1::jsonb) id', [J(d)])).id;
const asset = (id: string) => one<any>('select * from fixed_assets where id=$1', [id]);
const bal = async (code: string) => +(await one<any>(`select coalesce(sum(l.debit-l.credit),0) b from journal_lines l join accounts a on a.id=l.account_id join journal_vouchers v on v.id=l.voucher_id
  where a.code=$1`, [code])).b;
let machine = '', tool = '', building = '', land = '', truck = '', itc = '', furn = '', soft = '';
const A: Record<string, string> = {};

beforeAll(async () => {
  db = new PGlite();
  for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(new URL(f, dir), 'utf8'));
  for (const [c, n, t] of COA) await db.query('insert into accounts(code,name,type) values ($1,$2,$3) on conflict (code) do update set name=excluded.name,type=excluded.type', [c, n, t]);
  // บัญชีหมวดหลักของผัง (12616/12617/12619/18616/18617/58616/58617) เป็นบัญชีคุม ลงรายการไม่ได้ → ต้องสร้างบัญชีย่อยใต้กลุ่มก่อน
  for (const [code, name, parent] of [['12621', 'เครื่องจักรผลิตตะแกรง', '12616'], ['12622', 'อาคารโรงงาน', '12617'], ['12623', 'ที่ดินโรงงาน', '12619'],
    ['18621', 'ค่าเสื่อมสะสม-เครื่องจักรผลิต', '18616'], ['18622', 'ค่าเสื่อมสะสม-อาคารโรงงาน', '18617'],
    ['58621', 'ค่าเสื่อมราคา-เครื่องจักรผลิต', '58616'], ['58622', 'ค่าเสื่อมราคา-อาคารโรงงาน', '58617']])
    await db.query('select create_account($1,$2,null,$3)', [code, name, parent]);
  // หมวดที่โรงงานตะแกรงควรมี (ไม่มีในหมวดเริ่มต้น 6 หมวดของ FA)
  machine = await mkCat({ name: 'เครื่องจักรผลิต (เครื่องปั๊ม/ตัด/พับ)', life_years: 10, asset_account: '12621', dep_account: '58621', accum_account: '18621' });
  tool = await mkCat({ name: 'แม่พิมพ์และเครื่องมือ', life_years: 5, asset_account: '12621', dep_account: '58621', accum_account: '18621' });
  building = await mkCat({ name: 'อาคารโรงงาน', life_years: 20, asset_account: '12622', dep_account: '58622', accum_account: '18622' });
  land = await mkCat({ name: 'ที่ดิน', depreciate: false, asset_account: '12623' });
  truck = await cat('ยานพาหนะ'); itc = await cat('คอมพิวเตอร์/อุปกรณ์ไอที'); furn = await cat('เฟอร์นิเจอร์/อุปกรณ์สำนักงาน'); soft = await cat('ซอฟต์แวร์คอมพิวเตอร์');
});

describe('สินทรัพย์โรงงานตะแกรง', () => {
  it('หมวดใหม่: ที่ดินไม่คิดค่าเสื่อมไม่ต้องมีบัญชีค่าเสื่อม · หมวดคิดค่าเสื่อมต้องมีอายุ+บัญชี', async () => {
    expect((await one<any>('select depreciate, life_years from asset_categories where id=$1', [land])).depreciate).toBe(false);
    expect(await err(mkCat({ name: 'ผิด1', life_years: 5, asset_account: '12621' }))).toMatch(/บัญชีค่าเสื่อม/);
    expect(await err(mkCat({ name: 'คุม', life_years: 5, asset_account: '12616', dep_account: '58621', accum_account: '18621' }))).toMatch(/บัญชีคุม/);
    expect(await err(mkCat({ name: 'คุม2', life_years: 5, asset_account: '12621', dep_account: '58616', accum_account: '18621' }))).toMatch(/บัญชีคุม/);
    expect(await err(mkCat({ name: 'สลับ', life_years: 5, asset_account: '12621', dep_account: '18621', accum_account: '58621' }))).toMatch(/ค่าใช้จ่าย/);
    expect(await err(mkCat({ name: 'ผิด2', asset_account: '12621', dep_account: '58621', accum_account: '18621' }))).toMatch(/อายุ/);
    expect(await err(mkCat({ name: 'ผิด3', life_years: 5, asset_account: '51111', dep_account: '58621', accum_account: '18621' }))).toMatch(/1xxxx/);
    expect(await err(mkCat({ name: 'ที่ดิน', depreciate: false, asset_account: '12623' }))).not.toBe('');  // ชื่อซ้ำ
  });
  it('เพิ่มสินทรัพย์ยกมา 9 ชิ้น (ไม่ลงบัญชีตอนบันทึก)', async () => {
    const before = +(await one<any>('select count(*) c from journal_vouchers')).c;
    A.press = await mk({ name: 'เครื่องปั๊มตะแกรง 160 ตัน', category_id: machine, purchase_date: '2024-01-15', start_date: '2024-02-01', calc_start: '2024-02-01', cost: 2800000, salvage: 1, serial_no: 'PR-160-001', location: 'โรงงาน A' });
    A.shear = await mk({ name: 'เครื่องตัดเหล็กแผ่นไฮดรอลิก', category_id: machine, purchase_date: '2025-03-01', cost: 950000 });
    A.die = await mk({ name: 'แม่พิมพ์ตะแกรงเจาะรู 25 มม.', category_id: tool, purchase_date: '2026-03-10', cost: 180000 });
    A.bldg = await mk({ name: 'โรงงาน A', category_id: building, purchase_date: '2020-01-01', cost: 12000000, accum_open: 3000000, calc_start: '2026-01-01' });
    A.land = await mk({ name: 'ที่ดินโรงงาน', category_id: land, purchase_date: '2020-01-01', cost: 8000000 });
    A.truck = await mk({ name: 'รถบรรทุก 6 ล้อ', category_id: truck, purchase_date: '2025-06-01', cost: 1650000 });
    A.fork = await mk({ name: 'รถยกไฟฟ้า (โฟล์คลิฟท์)', category_id: truck, purchase_date: '2026-05-01', cost: 420000 });
    A.pc = await mk({ name: 'คอมพิวเตอร์ออกแบบ CAD', category_id: itc, purchase_date: '2026-06-01', cost: 45000 });
    A.cad = await mk({ name: 'ซอฟต์แวร์ CAD/CAM', category_id: soft, purchase_date: '2026-06-01', cost: 120000 });
    A.desk = await mk({ name: 'โต๊ะทำงานสำนักงาน', category_id: furn, purchase_date: '2026-01-10', cost: 24000 });
    expect(+(await one<any>('select count(*) c from journal_vouchers')).c).toBe(before);
    expect(+(await one<any>(`select count(*) c from fixed_assets where status='in_use'`)).c).toBe(10);
  });
  it('อัตรา/อายุ: เครื่องจักร 10 ปี = 10% · แม่พิมพ์ 5 ปี = 20% · อาคาร 20 ปี = 5% · ซอฟต์แวร์ 10 ปี · ที่ดินไม่มีค่าเสื่อม', async () => {
    const r = async (k: string) => one<any>('select asset_rate(life_years) rate, asset_annual(a) annual, depreciate from fixed_assets a where id=$1', [A[k]]);
    expect(+(await r('press')).rate).toBe(10); expect(+(await r('press')).annual).toBe(279999.9);   // (2,800,000−1)×10%
    expect(+(await r('die')).rate).toBe(20);
    expect(+(await r('bldg')).annual).toBe(599999.95);                                              // (12,000,000−1)×5%
    expect((await r('land')).depreciate).toBe(false);
    expect(+(await r('cad')).rate).toBe(10);
    expect(+(await r('truck')).rate).toBe(20);
  });
  it('ค่าเสื่อมปี 2026 รวมตามหมวด · ที่ดินไม่มีค่าเสื่อม · บัญชีสมดุล', async () => {
    const n = (await one<any>('select post_asset_depreciation(2026) n')).n;
    expect(+n).toBeGreaterThan(0);
    const jv = await rows(`select count(*) c from journal_vouchers where source_type='DEP' and reverses_id is null`);
    expect(+jv[0].c).toBe(12);
    // อาคาร: ยกมา 3,000,000 · ปี 2026 เต็มปี 365 วัน → 599,999.95
    // เครื่องปั๊ม: 279,999.90 · เครื่องตัด 94,999.90 · แม่พิมพ์ (10 มี.ค.–31 ธ.ค. = 297 วัน) · รถบรรทุก 329,999.80 · ฯลฯ
    expect(await bal('58622')).toBeCloseTo(599999.95, 1);
    expect(await bal('18622')).toBeCloseTo(-599999.95, 1);
    const tot = await one<any>(`select sum(l.debit) d, sum(l.credit) c from journal_lines l join journal_vouchers v on v.id=l.voucher_id where v.source_type='DEP'`);
    expect(+tot.d).toBeCloseTo(+tot.c, 2);
    expect(await bal('12623')).toBe(0);  // ยกมาไม่ลงบัญชี
    const land26 = await one<any>(`select asset_dep_period(a,'2026-01-01','2026-12-31') v from fixed_assets a where id=$1`, [A.land]);
    expect(+land26.v).toBe(0);
  });
  it('ค่าเสื่อมเครื่องปั๊มปี 2026 = 279,999.90 รวมเสื่อมรายเดือนตามวัน', async () => {
    const v = await one<any>(`select asset_dep_period(a,'2026-01-01','2026-12-31') v from fixed_assets a where id=$1`, [A.press]);
    expect(+v.v).toBe(279999.9);
    const months = await rows(`select sum(asset_dep_period(a, d::date, (d + interval '1 month - 1 day')::date)) s from fixed_assets a, generate_series('2026-01-01'::date,'2026-12-01'::date,'1 month') d where a.id=$1 group by a.id`, [A.press]);
    expect(+months[0].s).toBeCloseTo(279999.9, 1);
  });
  it('ขายรถบรรทุกกลางปี → ค่าเสื่อมหยุดที่วันขาย + JV ตัดสินทรัพย์ สมดุล', async () => {
    const id = (await one<any>(`select dispose_asset($1,'2026-09-30','sold',1200000,'ขายให้ลูกค้า') id`, [A.truck])).id;
    expect((await asset(A.truck)).status).toBe('sold');
    const l = await rows(`select a.code, l.debit, l.credit from journal_lines l join accounts a on a.id=l.account_id where voucher_id=$1 order by line_no`, [id]);
    const d = l.reduce((s, x) => s + +x.debit, 0), c = l.reduce((s, x) => s + +x.credit, 0);
    expect(d).toBeCloseTo(c, 2);
    expect(l.find(x => x.code === '12614' && +x.credit === 1650000)).toBeTruthy();   // ตัดทุน
    expect(l.find(x => x.code === '49990' && +x.debit === 1200000)).toBeTruthy();    // ราคาขายพักไว้ ตามต้นแบบ
  });
  it('บริจาค/ทำลายเครื่องมือเก่า · ลบสินทรัพย์ยกมาที่ยังใช้งาน · ย้อนสถานะ', async () => {
    const del = await mk({ name: 'ใส่ผิด', category_id: furn, purchase_date: '2026-02-01', cost: 1000 });
    await db.query('select delete_asset($1)', [del]);
    expect(+(await one<any>('select count(*) c from fixed_assets where id=$1', [del])).c).toBe(0);
    await db.query(`select dispose_asset($1,'2026-10-01','destroyed',0,'ชำรุด')`, [A.die]);
    expect((await asset(A.die)).status).toBe('disposed');
    await db.query('select reopen_asset($1)', [A.die]);
    expect((await asset(A.die)).status).toBe('in_use');
  });
  it('ซื้อรถยกใหม่ผ่านค่าใช้จ่าย (VAT 7%, หัก ณ ที่จ่าย) → สร้างสินทรัพย์เองด้วยราคาก่อน VAT', async () => {
    const v = (await one<any>(`insert into contacts(business_name) values ('บ. รถยกไทย') returning id`)).id;
    const b0 = await bal('12614');
    const e = (await one<any>('select save_expense($1::jsonb,$2::jsonb) id', [J({ date: '2026-10-05', contact: v }),
      J([{ description: 'รถยกไฟฟ้า 2.5 ตัน', qty: 1, unit_price: 535000, vat: '7', asset_category: truck }])])).id;
    const a = await one<any>('select * from fixed_assets where expense_id=$1', [e]);
    expect(+a.cost).toBe(535000); expect(a.vendor).toBe('บ. รถยกไทย'); expect(a.status).toBe('in_use');
    expect((await bal('12614')) - b0).toBe(535000);   // ยอดยกมาไม่ลงบัญชี (ตามต้นแบบ) → หลังขายรถที่ยกมา 12614 ติดลบจนกว่าจะลง JV ยกมา
    expect(+(await one<any>(`select sum(l.debit) d from journal_lines l join accounts a on a.id=l.account_id join journal_vouchers x on x.id=l.voucher_id where a.code='17113' and x.source_id=$1`, [e])).d).toBe(37450);
  });
  it('วงจรกลับรายการ: แก้ราคาสินทรัพย์หลังลงค่าเสื่อมแล้ว → ใบเดิม -R แล้วลงใหม่ ยอดคงเหลือสะสมถูกต้อง', async () => {
    const before = await bal('18621');
    await db.query(`select update_asset($1,$2::jsonb)`, [A.shear, J({ cost: 1000000 })]);
    const after = await bal('18621');
    expect(after).toBeLessThan(before);   // เครดิตมากขึ้น (ติดลบมากขึ้น) เพราะทุนสูงขึ้น
    const open = await rows(`select v.id from journal_vouchers v where source_type='DEP' and reverses_id is null and not exists (select 1 from journal_vouchers r where r.reverses_id=v.id)`);
    const sum = await one<any>(`select sum(l.debit) d, sum(l.credit) c from journal_lines l join journal_vouchers v on v.id=l.voucher_id where v.source_type='DEP'`);
    expect(+sum.d).toBeCloseTo(+sum.c, 2);
    expect(open.length).toBeGreaterThan(0);
  });
});
