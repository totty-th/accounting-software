import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { glRange, glList, glLedgers, glWorkbook, chartWorkbook, natural, faMoney, parseTypes } from '../web/lib/gl';

const dir = new URL('../supabase/migrations/', import.meta.url);
let pg: PGlite;
const db = { q: async <T = any>(sql: string, a: unknown[] = []) => (await pg.query<any>(sql, a)).rows as T[] };

beforeAll(async () => {
  pg = new PGlite(); for (const f of readdirSync(dir).sort()) await pg.exec(readFileSync(new URL(f, dir), 'utf8'));
  await pg.exec(`insert into accounts(code,name,type) values ('11100','เงินสดทดสอบ','asset'),('21100','เจ้าหนี้ทดสอบ','liability'),('41000','รายได้ทดสอบ','revenue'),('53000','ค่าใช้จ่ายทดสอบ','expense')`);
  const j = (d: string, n: string, l: string) => pg.query(`select post_voucher('JV',$1::date,$2,'MANUAL',$2,$3::jsonb)`, [d, n, l]);
  await j('2025-12-20', 'ยกมา', '[{"account":"11100","debit":1000},{"account":"21100","credit":1000}]');
  await j('2026-01-05', 'ขาย', '[{"account":"11100","debit":500},{"account":"41000","credit":500}]');
  await j('2026-02-10', 'จ่าย', '[{"account":"53000","debit":200},{"account":"11100","credit":200}]');
  await j('2026-02-11', 'ผิด', '[{"account":"53000","debit":50},{"account":"11100","credit":50}]');
  const v = (await pg.query<any>(`select id from journal_vouchers where memo='ผิด'`)).rows[0].id;
  await pg.query(`select reverse_voucher($1)`, [v]);
});

describe('M33 บัญชีแยกประเภทแบบ FA', () => {
  it('ช่วงวันที่: ค่าเริ่มต้น=ปีงบ · ทางลัด · เดือน · ปี · ช่วง', () => {
    const t = '2026-11-01';
    expect(glRange({}, t)).toMatchObject({ m: 'fy', from: '2026-01-01', to: '2026-12-31', label: 'ปีงบ 2026' });
    expect(glRange({ m: 'cur' }, t)).toMatchObject({ from: '2026-11-01', to: '2026-11-30' });
    expect(glRange({ m: 'prev' }, t)).toMatchObject({ from: '2026-10-01', to: '2026-10-31' });
    expect(glRange({ m: '3m' }, t)).toMatchObject({ from: '2026-09-01', to: '2026-11-30' });
    expect(glRange({ m: '12m' }, t)).toMatchObject({ from: '2025-12-01', to: '2026-11-30' });
    expect(glRange({ m: 'yprev' }, t)).toMatchObject({ from: '2025-01-01', to: '2025-12-31' });
    expect(glRange({ m: 'prev' }, '2026-01-15')).toMatchObject({ from: '2025-12-01', to: '2025-12-31' });
    expect(glRange({ m: 'month', month: '2026-02' }, t)).toMatchObject({ from: '2026-02-01', to: '2026-02-28' });
    expect(glRange({ m: 'year', year: '2024' }, t)).toMatchObject({ from: '2024-01-01', to: '2024-12-31' });
    expect(glRange({ m: 'range', from: '2026-03-05', to: '2026-04-01' }, t)).toMatchObject({ from: '2026-03-05', to: '2026-04-01' });
    expect(glRange({ m: 'range', from: '2026-05-05', to: '2026-04-01' }, t).m).toBe('fy');   // ช่วงกลับด้าน → ค่าเริ่มต้น
    expect(glRange({ m: 'month', month: '2026-13' }, t).m).toBe('fy');
  });
  it('ยอดตามด้านปกติ + รูปแบบตัวเลข', () => {
    expect(natural('asset', -5)).toBe(-5); expect(natural('liability', -5)).toBe(5); expect(natural('revenue', -500)).toBe(500);
    expect(faMoney(0)).toBe('-'); expect(faMoney(-296941.9)).toBe('(296,941.90)'); expect(faMoney(5817)).toBe('5,817.00');
    expect(parseTypes('asset,foo,expense')).toEqual(['asset', 'expense']);
  });
  it('รายการ: กรองหมวดหลายหมวด + ค้นหา + ยอดงบแสดงฐานะสะสม / รายได้ค่าใช้จ่ายเฉพาะช่วง', async () => {
    const base = { from: '2026-01-01', to: '2026-12-31', all: true, desc: false };
    const t = await glList(db, { ...base, q: '', types: ['asset', 'revenue'] });
    expect(t.every(a => ['asset', 'revenue'].includes(a.type))).toBe(true);
    const by = (rows: any[], c: string) => rows.find(a => a.code === c);
    expect(by(t, '11100').bal).toBe(1300);        // 1000+500-200 (ใบผิด-ใบกลับรายการหักล้าง)
    expect(by(t, '41000').bal).toBe(500);
    const x = await glList(db, { ...base, q: 'ทดสอบ', types: [], from: '2026-02-01', to: '2026-02-28' });
    expect(by(x, '11100').bal).toBe(1300);
    expect(by(x, '41000').bal).toBe(0);            // รายได้เฉพาะช่วง ก.พ. = 0
    expect(by(x, '53000').bal).toBe(200);
    expect((await glList(db, { ...base, q: '41000', types: [], desc: true }))[0].code).toBe('41000');
  });
  it('บัญชีรายตัว: ยอดยกมา · ยอดสะสม · ซ่อน/แสดงรายการยกเลิก', async () => {
    const [l] = await glLedgers(db, ['11100'], '2026-01-01', '2026-12-31', false);
    expect(l.opening).toBe(1000);
    expect(l.lines.map(x => x.no.slice(0, 2))).toEqual(['JV', 'JV']);
    expect(l.lines.map(x => x.bal)).toEqual([1500, 1300]); expect(l.closing).toBe(1300);
    const [w] = await glLedgers(db, ['11100'], '2026-01-01', '2026-12-31', true);
    expect(w.lines).toHaveLength(4); expect(w.lines.filter(x => x.cancelled)).toHaveLength(2);
    const [s] = await glLedgers(db, ['11100'], '2026-01-01', '2026-12-31', false, 'ขาย');
    expect(s.lines).toHaveLength(1);
    const [r] = await glLedgers(db, ['53000'], '2026-02-01', '2026-12-31', false);   // รายได้/ค่าใช้จ่าย: ยกมาเฉพาะตั้งแต่ต้นปี
    expect(r.opening).toBe(0); expect(r.closing).toBe(200);
    const [c] = await glLedgers(db, ['21100'], '2026-01-01', '2026-12-31', false);   // เครดิตปกติ
    expect(c.opening).toBe(1000); expect(c.closing).toBe(1000);
  });
  it('Excel: บัญชีเดียวมียอดยกมา/ยอดคงเหลือ · หลายบัญชีเฉพาะที่มีรายการ · ผังบัญชี', async () => {
    const g = await glWorkbook(db, { company: 'บริษัททดสอบ', user: 'ผู้ใช้', today: '2026-11-01', codes: ['11100'], from: '2026-01-01', to: '2026-12-31', explicit: true });
    const ws = g.wb.getWorksheet('Book Of Account')!;
    expect(ws.getCell('C1').value).toBe('บัญชีแยกประเภท'); expect(ws.getCell('B3').value).toBe('01-01-2026 ถึง 31-12-2026'); expect(ws.getCell('B4').value).toBe('11100');
    expect(ws.getRow(6).getCell(1).value).toBe('รหัสบัญชี'); expect(ws.getRow(7).getCell(8).value).toBe('ยอดยกมา'); expect(ws.getRow(7).getCell(12).value).toBe(1000);
    const last = ws.getRow(ws.rowCount); expect(last.getCell(8).value).toBe('ยอดคงเหลือ'); expect(last.getCell(11).value).toBe(1300); expect(last.getCell(12).value).toBe('Dr.');
    const m = await glWorkbook(db, { company: 'x', user: 'y', today: '2026-11-01', codes: ['11100', '21100', '41000', '53000'], from: '2026-03-01', to: '2026-12-31', explicit: false });
    expect(m.first).toBe('');   // ช่วง มี.ค.–ธ.ค. ไม่มีรายการ (มีแต่ยอดยกมา) → ไม่รวม
  });
  it('Excel (ไม่มีรายการในช่วง): ไม่มีบัญชีที่มีรายการ → ว่าง', async () => {
    const m = await glWorkbook(db, { company: 'x', user: 'y', today: '2026-11-01', codes: ['11100', '53000'], from: '2026-03-01', to: '2026-12-31', explicit: false });
    expect(m.first).toBe('');
    const c = await chartWorkbook(db, { company: 'x', user: 'y', today: '2026-11-01', rows: [{ code: '11100', name: 'เงินสด', type: 'asset', description: null, is_active: true }] });
    expect(c.getWorksheet('Chart of Accounts')!.getRow(6).getCell(4).value).toBe('สินทรัพย์');
  });
});
