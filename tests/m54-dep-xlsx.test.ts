import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { depXlsx } from '../web/lib/assets-xlsx';

// ไฟล์ Excel "ตารางคำนวณค่าเสื่อมราคา" ต้องตรงรูปแบบ FA (17 คอลัมน์ จัดกลุ่มตามหมวด ยอดรวมต่อหมวด+ทั้งสิ้น) และยอดตรงตารางบนหน้าจอ
const dir = new URL('../supabase/migrations/', import.meta.url);
let db: PGlite; let itCat: string, furCat: string;
const one = async <T = any>(q: string, a: unknown[] = []) => (await db.query<any>(q, a)).rows[0] as T;
const mk = (o: Record<string, unknown>) => one(`select create_asset($1::jsonb) id`, [JSON.stringify(o)]);
const adapter = { q: async (sql: string, a: unknown[] = []) => (await db.query<any>(sql, a)).rows as any[] };
const dateIso = (d: any) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));

beforeAll(async () => {
  db = new PGlite();
  for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(new URL(f, dir), 'utf8'));
});
beforeEach(async () => {
  await db.exec(`truncate fixed_assets, expense_lines, expenses, journal_lines, journal_vouchers, doc_sequences, accounts cascade`);
  await db.exec(`delete from company_profile; insert into company_profile(name, tax_id) values ('บริษัท ทดสอบ จำกัด', '0105500000000')`).catch(() => {});
  itCat = (await one<any>(`select id from asset_categories where name = 'คอมพิวเตอร์/อุปกรณ์ไอที'`)).id;
  furCat = (await one<any>(`select id from asset_categories where name like 'เฟอร์นิเจอร์/อุปกรณ์สำนักงาน'`)).id;
});

describe('Excel ตารางคำนวณค่าเสื่อมราคา', () => {
  it('หัวไฟล์ + 17 คอลัมน์ + ยอดรวมต่อหมวด/ทั้งสิ้น ตรงกับยอดคำนวณ', async () => {
    await mk({ name: 'โน๊ตบุ๊ก', category_id: itCat, purchase_date: '2026-03-01', cost: 36000 });
    await mk({ name: 'เครื่องพิมพ์', category_id: itCat, purchase_date: '2026-05-10', cost: 8900 });
    await mk({ name: 'โต๊ะทำงาน', category_id: furCat, purchase_date: '2026-02-01', cost: 12000 });
    const rows = (await adapter.q(`select a.*, c.name cat_name, c.sort_no, asset_accum_at(a, '2026-01-01'::date - 1) accum_in, a.cost - asset_accum_at(a, '2026-01-01'::date - 1) book_in,
        asset_dep_days(a, '2026-01-01', '2026-12-31') days, asset_dep_period(a, '2026-01-01', '2026-12-31') dep, asset_accum_at(a, '2026-12-31') accum_out,
        a.cost - asset_accum_at(a, '2026-12-31') book_out, asset_rate(a.life_years) rate, null::text exp_no
      from fixed_assets a join asset_categories c on c.id = a.category_id where a.status <> 'void' and a.depreciate order by c.sort_no, a.start_date, a.code`))
      .map(r => ({ ...r, start: dateIso(r.start_date), disp: '' }));
    const wb = await depXlsx(adapter, rows, 2026, '2026-11-15');
    const ws = wb.getWorksheet('DepreciationReport')!;
    expect(ws).toBeTruthy();
    expect(ws.getCell('A1').value).toBe('ตารางคำนวณค่าเสื่อมราคา');
    expect(ws.getCell('A2').value).toBe('ชื่อบริษัท');
    const hdr = ws.getRow(7).values as any[];
    expect(hdr.slice(1).length).toBe(17);
    expect(hdr[1]).toBe('รหัสสินทรัพย์'); expect(hdr[13]).toMatch(/ค่าเสื่อมราคาของงวด|ค่าเสื่อม/);
    const all: any[][] = []; ws.eachRow((r, n) => { if (n > 7) all.push(r.values as any[]); });
    const total = all.find(r => r[1] === 'ยอดรวมทั้งสิ้น')!;
    const sumDep = Math.round(rows.reduce((s, r) => s + +r.dep, 0) * 100) / 100;
    expect(+total[13]).toBeCloseTo(sumDep, 2);
    expect(+total[5]).toBeCloseTo(56900, 2);
    expect(all.filter(r => r[1] === 'ยอดรวม')).toHaveLength(2);       // 2 หมวด
    expect(all.some(r => /คอมพิวเตอร์\/อุปกรณ์ไอที 2 รายการ/.test(String(r[1])))).toBe(true);
  });
});
