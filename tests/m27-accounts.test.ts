import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';

const dir = new URL('../supabase/migrations/', import.meta.url);
let db: PGlite;
const one = async <T = any>(q: string, p: unknown[] = []) => (await db.query<any>(q, p)).rows[0] as T;
const err = async (p: Promise<unknown>) => { try { await p; return ''; } catch (e) { return (e as Error).message; } };
const bal = async (code: string) => (await one<any>(`select coalesce(sum(l.debit-l.credit),0)::float8 b from journal_lines l join accounts a on a.id=l.account_id where a.code=$1`, [code])).b;

beforeAll(async () => {
  db = new PGlite(); for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(new URL(f, dir), 'utf8'));
  await db.exec(`insert into accounts(code,name,type) values ('11100','เงินสด','asset'),('21100','เจ้าหนี้','liability'),('31000','ทุน','equity'),('41000','รายได้','revenue')`);
});

describe('M27.3 บริหารผังบัญชี', () => {
  it('สร้างบัญชี: ชนิดมาจากหลักแรกของรหัส, รหัสซ้ำ/รูปแบบผิดถูกปฏิเสธ', async () => {
    const { id } = await one<any>(`select create_account('53012','ค่าน้ำมัน','รถส่งของ') id`);
    const a = await one<any>('select * from accounts where id=$1', [id]);
    expect(a.type).toBe('expense'); expect(a.description).toBe('รถส่งของ');
    await db.query(`select create_account('11101.01','เงินฝากย่อย')`);
    expect((await one<any>(`select type from accounts where code='11101.01'`)).type).toBe('asset');
    expect(await err(db.query(`select create_account('53012','ซ้ำ')`))).toContain('มีอยู่แล้ว');
    expect(await err(db.query(`select create_account('9','x')`))).toContain('เลข 5 หลัก');
    expect(await err(db.query(`select create_account('61000','x')`))).toContain('เลข 5 หลัก');
    expect(await err(db.query(`select create_account('53013','  ')`))).toContain('ต้องระบุชื่อ');
  });
  it('แก้ชื่อได้ · ปิดใช้งานได้เมื่อยอดเป็นศูนย์ · ปิดไม่ได้เมื่อมียอด/ระบบอ้างอิง', async () => {
    const id = (await one<any>(`select id from accounts where code='53012'`)).id;
    await db.query(`select update_account($1,'ค่าน้ำมันรถ',null,true)`, [id]);
    expect((await one<any>('select name from accounts where id=$1', [id])).name).toBe('ค่าน้ำมันรถ');
    await db.query(`select update_account($1,'ค่าน้ำมันรถ',null,false)`, [id]);
    expect((await one<any>('select is_active from accounts where id=$1', [id])).is_active).toBe(false);
    const cash = (await one<any>(`select id from accounts where code='11100'`)).id;
    await db.query(`select post_voucher('JV','2026-01-05','x','MANUAL','t1','[{"account":"11100","debit":5},{"account":"41000","credit":5}]'::jsonb)`);
    expect(await err(db.query(`select update_account($1,'เงินสด',null,false)`, [cash]))).toContain('ยอดคงเหลือ');
    const re = (await one<any>(`select a.id from system_accounts s join accounts a on a.code=s.account_code limit 1`));
    if (re) expect(await err(db.query(`select update_account($1,'x',null,false)`, [re.id]))).not.toBe('');
  });
});

describe('M27.3 ยอดเริ่มต้น', () => {
  const L = [{ account: '11100', debit: 1000 }, { account: '21100', credit: 400 }, { account: '31000', credit: 600 }];
  it('ลงยอดเริ่มต้นสมดุล · ลงซ้ำ = กลับรายการใบเดิมแล้วลงใหม่ (ยอดไม่ซ้อน)', async () => {
    const before = await bal('11100');
    const v1 = (await one<any>(`select set_opening_balance('2026-01-01',$1::jsonb) id`, [JSON.stringify(L)])).id;
    expect(v1).toBeTruthy(); expect(await bal('11100')).toBe(before + 1000);
    await db.query(`select set_opening_balance('2026-01-01',$1::jsonb)`, [JSON.stringify([{ account: '11100', debit: 700 }, { account: '31000', credit: 700 }])]);
    expect(await bal('11100')).toBe(before + 700); expect(await bal('21100')).toBe(0);
    const n = (await one<any>(`select count(*)::int n from journal_vouchers v where source_type='OPENING' and reverses_id is null and not exists (select 1 from journal_vouchers r where r.reverses_id=v.id)`)).n;
    expect(n).toBe(1);
  });
  it('ปฏิเสธ: ไม่สมดุล / บัญชีรายได้-ค่าใช้จ่าย / ไม่มีบัญชี · ส่งว่าง = ล้างยอดเริ่มต้น', async () => {
    expect(await err(db.query(`select set_opening_balance('2026-01-01',$1::jsonb)`, [JSON.stringify([{ account: '11100', debit: 5 }, { account: '31000', credit: 4 }])]))).not.toBe('');
    expect(await err(db.query(`select set_opening_balance('2026-01-01',$1::jsonb)`, [JSON.stringify([{ account: '41000', credit: 5 }, { account: '31000', debit: 5 }])]))).toContain('เฉพาะบัญชีสินทรัพย์');
    expect(await err(db.query(`select set_opening_balance('2026-01-01',$1::jsonb)`, [JSON.stringify([{ account: 'ZZ', debit: 5 }])]))).toContain('ไม่พบบัญชี');
    expect(await bal('11100')).toBe(5 + 700);
    await db.query(`select set_opening_balance('2026-01-01','[]'::jsonb)`);
    expect(await bal('11100')).toBe(5);
  });
});
