import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { glList, chartWorkbook } from '../web/lib/gl';

const dir = new URL('../supabase/migrations/', import.meta.url);
let pg: PGlite;
const one = async <T = any>(q: string, p: unknown[] = []) => (await pg.query<any>(q, p)).rows[0] as T;
const err = async (p: Promise<unknown>) => { try { await p; return ''; } catch (e) { return (e as Error).message; } };
const db = { q: async <T = any>(sql: string, a: unknown[] = []) => (await pg.query<any>(sql, a)).rows as T[] };
const parentOf = async (code: string) => (await one<any>(`select p.code from accounts a join accounts p on p.id = a.parent_id where a.code = $1`, [code]))?.code ?? null;

beforeAll(async () => { pg = new PGlite(); for (const f of readdirSync(dir).sort()) await pg.exec(readFileSync(new URL(f, dir), 'utf8')); });

describe('M34 บริหารผังบัญชีแบบ FA (ต้นไม้ บัญชีคุม/บัญชีย่อย)', () => {
  it('ผังมาตรฐาน: บัญชีคุม 5 หมวดเป็นราก · ลำดับชั้นตามแบบแผนรหัส · บัญชีที่ระบบสร้างเองเข้ากลุ่มอัตโนมัติ', async () => {
    expect((await db.q(`select code from accounts where parent_id is null order by code`)).map((r: any) => r.code)).toEqual(['10000', '20000', '30000', '40000', '50000']);
    expect(await parentOf('11000')).toBe('10000'); expect(await parentOf('11100')).toBe('11000'); expect(await parentOf('12200')).toBe('12000');
    expect(await parentOf('12300')).toBe('12000'); expect(await parentOf('52000')).toBe('50000');
    expect(await parentOf('11122')).toBe('11120');   // บัญชีคุมของธนาคาร
    expect((await one<any>(`select count(*)::int c from accounts where is_control`)).c).toBeGreaterThan(150);
    await pg.query(`insert into accounts(code, name, type) values ('11122.99','ธนาคารทดสอบ','asset')`);
    expect(await parentOf('11122.99')).toBe('11122');
  });
  it('สร้างบัญชี: ตำแหน่งตามกลุ่มที่เลือก (รหัสไม่ต้องขึ้นต้นตามกลุ่ม) · ชนิดตามกลุ่ม', async () => {
    await pg.query(`select create_account('12345','ทดสอบนอกกลุ่ม',null,'31000',true)`);
    const a = await one<any>(`select a.type, a.is_control, p.code pc from accounts a join accounts p on p.id = a.parent_id where a.code = '12345'`);
    expect(a).toEqual({ type: 'equity', is_control: true, pc: '31000' });
    await pg.query(`select create_account('12346','ใต้บัญชีคุมใหม่','d','12345',false,'Leaf','Leaf desc')`);
    expect(await parentOf('12346')).toBe('12345');
    expect((await one<any>(`select name_en, description_en from accounts where code='12346'`))).toEqual({ name_en: 'Leaf', description_en: 'Leaf desc' });
    // ไม่ระบุกลุ่ม → หาจากรูปแบบรหัส
    await pg.query(`select create_account('53777','ค่าน้ำมัน')`);
    expect((await parentOf('53777'))?.startsWith('53')).toBe(true);
    expect((await one<any>(`select p.is_control from accounts a join accounts p on p.id = a.parent_id where a.code='53777'`)).is_control).toBe(true);
  });
  it('ตรวจข้อมูล: ไม่ครบ · รหัสซ้ำ · กลุ่มไม่ใช่บัญชีคุม', async () => {
    expect(await err(pg.query(`select create_account('','')`))).toMatch(/กรุณากรอกรหัสบัญชี และกรุณากรอกชื่อบัญชี/);
    expect(await err(pg.query(`select create_account('', 'x')`))).toContain('กรุณากรอกรหัสบัญชี');
    expect(await err(pg.query(`select create_account('53778', '  ')`))).toContain('กรุณากรอกชื่อบัญชี');
    expect(await err(pg.query(`select create_account('12345','ซ้ำ',null,'31000')`))).toContain('ต้องไม่ซ้ำกัน');
    expect(await err(pg.query(`select create_account('53779','x',null,'53777')`))).toContain('ไม่พบกลุ่มบัญชี');
  });
  it('บัญชีคุมลงรายการไม่ได้ · บัญชีย่อยลงได้', async () => {
    await pg.query(`select create_account('11199','เงินสดทดสอบ',null,'11110',false)`); await pg.query(`select create_account('41777','รายได้ทดสอบ',null,'41000',false)`);
    expect(await err(pg.query(`select post_voucher('JV','2026-01-05','x','MANUAL','c1','[{"account":"11100","debit":5},{"account":"41000","credit":5}]'::jsonb)`))).toContain('ลงรายการในบัญชีคุมไม่ได้');
    await pg.query(`select post_voucher('JV','2026-01-05','x','MANUAL','c2','[{"account":"11199","debit":5},{"account":"41777","credit":5}]'::jsonb)`);
  });
  it('แก้ไขชื่อไทย/อังกฤษ · ลบได้เฉพาะบัญชีที่ไม่มีรายการ/บัญชีลูก/ระบบอ้างอิง', async () => {
    const id = (await one<any>(`select id from accounts where code='12346'`)).id;
    await pg.query(`select update_account($1,'ชื่อใหม่',null,true,'New name',null)`, [id]);
    expect((await one<any>(`select name, name_en from accounts where id=$1`, [id]))).toEqual({ name: 'ชื่อใหม่', name_en: 'New name' });
    expect(await err(pg.query(`select update_account($1,' ',null,true)`, [id]))).toContain('กรุณากรอกชื่อบัญชี');
    const par = (await one<any>(`select id from accounts where code='12345'`)).id;
    expect(await err(pg.query(`select delete_account($1)`, [par]))).toContain('บัญชีลูก');
    await pg.query(`select delete_account($1)`, [id]); await pg.query(`select delete_account($1)`, [par]);
    expect(await one<any>(`select 1 x from accounts where code in ('12345','12346')`)).toBeUndefined();
    const used = (await one<any>(`select id from accounts where code='11199'`)).id;
    expect(await err(pg.query(`select delete_account($1)`, [used]))).toContain('มีรายการบัญชีแล้ว');
    const sys = (await one<any>(`select a.id from system_accounts s join accounts a on a.code = s.account_code where not exists (select 1 from journal_lines l where l.account_id = a.id) and not exists (select 1 from accounts c where c.parent_id = a.id) limit 1`));
    if (sys) expect(await err(pg.query(`select delete_account($1)`, [sys.id]))).toContain('ระบบ');
  });
  it('รายการบัญชี: ไม่รวมบัญชีคุม · ชื่อกลุ่มระดับ 2/3 · ยอดเดบิต−เครดิต · ค้นด้วยชื่อกลุ่ม', async () => {
    const r = await glList(db, { q: '', types: [], from: '2026-01-01', to: '2026-12-31', all: true, desc: false });
    expect(r.some(a => a.code === '11000')).toBe(false);
    const cash = r.find(a => a.code === '11199')!;
    expect(cash.bal).toBe(5);
    const rev = r.find(a => a.code === '41777')!; expect(rev.bal).toBe(-5);   // เครดิตสุทธิ = ติดลบ (แบบ FA)
    const x = await glList(db, { q: 'เงินสดและรายการเทียบเท่าเงินสด', types: [], from: '2026-01-01', to: '2026-12-31', all: true, desc: false });
    expect(x.some(a => a.code.startsWith('111'))).toBe(true);
    const g = r.find(a => a.code === '11199')!; expect(g.g2).toBeTruthy(); expect(typeof g.g3).toBe('string');
  });
  it('Excel โครงสร้างผังบัญชี: บัญชีคุมและบัญชีย่อย พร้อมชื่ออังกฤษ', async () => {
    const wb = await chartWorkbook(db, { company: 'บ.ทดสอบ', user: 'ผู้ใช้', now: '01/11/2026 16:24' });
    const ws = wb.getWorksheet('Chart of Accounts')!;
    expect(ws.getCell('A2').value).toBe('ผังบัญชี / Chart of Account');
    expect(ws.getRow(5).values).toEqual([undefined, 'Code', 'ชื่อบัญชี', 'Account Name', 'ประเภท', 'Category', 'ประเภทบัญชี', 'Account Type']);
    const r6 = ws.getRow(6).values as any[]; expect(r6[1]).toBe('10000'); expect(r6[3]).toBe('Assets'); expect(r6[6]).toBe('บัญชีคุม'); expect(r6[7]).toBe('Control Account');
  });
});
