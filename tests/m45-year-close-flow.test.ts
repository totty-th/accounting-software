import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { COA } from '../web/lib/seed';

// ปิดงบประจำปีหลังมีรายการจริง: ขาย/ซื้อ/ค่าใช้จ่าย → ปิดงวด (CP) → กำไรสะสม → งบสมดุล → ปีใหม่เริ่มศูนย์ → รีเซ็ต
const dir = new URL('../supabase/migrations/', import.meta.url);
let db: PGlite;
const one = async <T = any>(q: string, a: unknown[] = []) => (await db.query<any>(q, a)).rows[0] as T;
const rows = async (q: string, a: unknown[] = []) => (await db.query<any>(q, a)).rows;
const J = JSON.stringify;
const err = async (p: Promise<unknown>) => { try { await p; return ''; } catch (e) { return (e as Error).message; } };
const gl = async (code: string, to = '2099-12-31') => +(await one<any>(`select coalesce(sum(l.debit-l.credit),0) b from journal_lines l join journal_vouchers v on v.id=l.voucher_id join accounts a on a.id=l.account_id where a.code=$1 and v.voucher_date<=$2`, [code, to])).b;
let cu: string, sup: string, pr: string; let profit = 0;

beforeAll(async () => {
  db = new PGlite();
  for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(new URL(f, dir), 'utf8'));
  for (const [c, n, t] of COA) await db.query('insert into accounts(code,name,type) values ($1,$2,$3) on conflict (code) do update set name=excluded.name,type=excluded.type,is_control=false', [c, n, t]);
  cu = (await one<any>(`insert into contacts(business_name,tax_id) values ('ลูกค้า','0105533333333') returning id`)).id;
  sup = (await one<any>(`insert into contacts(business_name,tax_id) values ('ผู้ขาย','0105511111111') returning id`)).id;
  pr = (await one<any>(`insert into products(code,name,kind,sale_price,purchase_price,base_unit) values ('FG','ตะแกรง','goods_stock',1000,600,'แผ่น') returning id`)).id;
  await db.query('select create_goods_receipt($1::date,$2,$3::jsonb)', ['2026-03-01', sup, J([{ product_id: pr, qty: 100, unit_price: 600 }])]);
  for (const [d, q] of [['2026-04-10', 20], ['2026-08-15', 30], ['2026-12-20', 10]] as [string, number][])
    await db.query('select create_invoice_full($1::jsonb,$2::jsonb)', [J({ date: d, contact: cu }), J([{ product_id: pr, qty: q, unit_price: 1000 }])]);
  const e = (await one<any>('select create_expense($1::date,$2,$3::jsonb) id', ['2026-06-30', sup, J([{ description: 'ค่าเช่าโกดัง', account: '53102', qty: 1, unit_price: 15000, wht_rate: 5 }])])).id;
  await db.query('select pay_expense($1,$2::date)', [e, '2026-07-01']);
  // ปี 2027: ขายอีกหนึ่งใบ
  await db.query('select create_invoice_full($1::jsonb,$2::jsonb)', [J({ date: '2027-01-15', contact: cu }), J([{ product_id: pr, qty: 5, unit_price: 1000 }])]);
});

describe('ปิดงบประจำปี 2026', () => {
  it('ก่อนปิด: กำไรปี 2026 = รายได้ 60,000 − ค่าเช่า 15,000 = 45,000 (ไม่มีต้นทุนขายตาม M12)', async () => {
    profit = +(await one<any>(`select net_profit('2026-01-01','2026-12-31') p`)).p;
    expect(profit).toBe(45000);
  });
  it('ปิดงวด: ใบ CP ลงวันที่ 31-12 ปิดบัญชีรายได้/ค่าใช้จ่ายเป็น 0 โอนกำไรเข้า 32000', async () => {
    const v = (await one<any>('select close_year(2026) v')).v;
    expect(+(await one<any>(`select count(*) n from journal_vouchers where id=$1 and voucher_type='CP' and voucher_date='2026-12-31'`, [v])).n).toBe(1);
    expect(await gl('41110', '2026-12-31')).toBe(0); expect(await gl('53102', '2026-12-31')).toBe(0);
    expect(await gl('32000', '2026-12-31')).toBe(-profit);
  });
  it('งบฐานะการเงิน ณ 31-12-2026 สมดุล และกำไรสะสมรวมกำไรปี 2026', async () => {
    const bs = await rows(`select * from balance_sheet('2026-12-31')`);
    const sum = (s: string) => bs.filter((r: any) => r.section === s).reduce((a: number, r: any) => a + Number(r.amount), 0);
    expect(sum('asset')).toBeCloseTo(sum('liability') + sum('equity'), 2);
    expect(+bs.find((r: any) => r.code === '32000').amount).toBe(profit);
  });
  it('งบกำไรขาดทุนปี 2026 หลังปิด: ใบ CP ไม่ถูกนับเป็นรายได้/ค่าใช้จ่าย (ยังเห็น 45,000)', async () => {
    expect(+(await one<any>(`select net_profit('2026-01-01','2026-12-31') p`)).p).toBe(profit);
  });
  it('ปีใหม่เริ่มศูนย์: รายได้ปี 2027 นับเฉพาะปี 2027', async () => {
    expect(+(await one<any>(`select net_profit('2027-01-01','2027-12-31') p`)).p).toBe(5000);
  });
  it('ปิดซ้ำไม่ได้ · ปีที่ไม่มีรายการปิดไม่ได้', async () => {
    expect(await err(db.query('select close_year(2026)'))).toContain('ปิดงวดแล้ว');
    expect(await err(db.query('select close_year(2024)'))).toContain('ไม่มีรายการ');
  });
  it('รีเซ็ตการปิดงวด: ใบ CP ถูกกลับรายการ ยอดรายได้ปี 2026 กลับมา และปิดใหม่ได้', async () => {
    await db.query('select reset_year_close(2026)');
    expect(await gl('32000', '2026-12-31')).toBe(0);
    expect(await gl('41110', '2026-12-31')).toBe(-60000);
    await db.query('select close_year(2026)');
    expect(await gl('32000', '2026-12-31')).toBe(-profit);
  });
});
