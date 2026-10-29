import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';

const dir = new URL('../supabase/migrations/', import.meta.url);
let db: PGlite; let ri36: string; let ri30: string; let pp36: string;
const one = async <T = any>(q: string, p: unknown[] = []) => (await db.query<any>(q, p)).rows[0] as T;
const err = async (p: Promise<unknown>) => { try { await p; return ''; } catch (e) { return (e as Error).message; } };
const entries = async (v: string) => (await db.query<any>(`select a.code, l.debit::float8 d, l.credit::float8 c from journal_lines l join accounts a on a.id=l.account_id where voucher_id=$1 order by line_no`, [v])).rows.map(x => [x.code, x.d, x.c]);
const j = (x: unknown) => JSON.stringify(x);

beforeAll(async () => {
  db = new PGlite(); for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(new URL(f, dir), 'utf8'));
  await db.exec(`insert into accounts(code,name,type) values ('51111','ซื้อสินค้า','expense'),('17111','ภาษีซื้อ ภ.พ.30','asset'),('17113','ภาษีซื้อยังไม่ถึงกำหนด','asset'),('17114','ภาษีรอขอคืน','asset'),('27111','ภาษีขาย','liability'),('27140','เจ้าหนี้สรรพากร','liability'),('21399','เจ้าหนี้','liability'),('11112','ธนาคาร','asset'),('11311','ลูกหนี้','asset')`);
  await db.exec(`insert into contacts(contact_name, business_name) values ('ผู้ขาย','Vendor Co')`);
  const c = (await one<any>(`select id from contacts limit 1`)).id;
  const mk = async (no: string, vat: number) => {
    const uv = (await one<any>(`select post_voucher('UV','2026-10-23','ซื้อ','MANUAL',$1,$2::jsonb) v`, [no, j([{ account: '51111', debit: 1000 }, { account: '17113', debit: vat }, { account: '21399', credit: 1000 + vat }])])).v;
    return (await one<any>(`insert into goods_receipts(ri_no, ri_date, contact_id, status, subtotal, vat, total, uv_voucher_id) values ($1,'2026-10-23',$2,'approved',1000,$3,$4,$5) returning id`, [no, c, vat, 1000 + vat, uv])).id;
  };
  ri36 = await mk('RI-36', 70); ri30 = await mk('RI-30', 70);
  await db.query(`select set_purchase_tax_invoice('RI',$1,$2::jsonb)`, [ri36, j({ invoice_no: 'F-1', invoice_date: '2026-10-23', vat_form: 'PP36' })]);
  await db.query(`select set_purchase_tax_invoice('RI',$1,$2::jsonb)`, [ri30, j({ invoice_no: 'T-1', invoice_date: '2026-10-23', vat_form: 'PP30' })]);
  await db.query(`select post_voucher('SV','2026-10-20','ขาย','MANUAL','s1',$1::jsonb)`, [j([{ account: '11311', debit: 535 }, { account: '27111', credit: 35 }, { account: '11112', credit: 500 }])]);
  await db.query(`select post_voucher('SV','2026-10-21','ขาย','MANUAL','s2',$1::jsonb)`, [j([{ account: '11311', debit: 5350 }, { account: '27111', credit: 350 }, { account: '11112', credit: 5000 }])]);
  pp36 = (await one<any>(`select file_pp36('2026-10-01',$1::jsonb) id`, [j([{ type: 'RI', id: ri36 }])])).id;
});
describe('M27.5 ภ.พ.30 เลือกใบกำกับ + ยื่นเพิ่มเติม', () => {
  it('ภ.พ.36 ต้องชำระและบันทึกใบเสร็จสรรพากรก่อน จึงเลือกใน ภ.พ.30 ได้', async () => {
    expect(await err(db.query(`select file_pp30('2026-10-01',$1::jsonb)`, [j([{ type: 'RI', id: ri36 }])]))).toContain('ยังไม่ได้ยื่น/ชำระ');
    expect(await err(db.query(`select set_pp36_receipt('RI',$1,'RD-1','2026-11-05')`, [ri36]))).toContain('ต้องบันทึกชำระ');
    await db.query(`select pay_pp36($1,'2026-11-05'::date)`, [pp36]);
    expect(await err(db.query(`select file_pp30('2026-10-01',$1::jsonb)`, [j([{ type: 'RI', id: ri36 }])]))).toContain('ยังไม่ได้ยื่น/ชำระ');
    await db.query(`select set_pp36_receipt('RI',$1,'RD-1','2026-11-05')`, [ri36]);
    expect(await err(db.query(`select reset_pp36_payment($1)`, [pp36]))).toContain('ใบเสร็จสรรพากร');
  });
  it('ยื่นปกติ: เลือก ภ.พ.30 + ภ.พ.36 → UV Dr 17111/17112 Cr 17113 · JV หักกลบ ต้องชำระ', async () => {
    const id = (await one<any>(`select file_pp30('2026-10-01',$1::jsonb) id`, [j([{ type: 'RI', id: ri30 }, { type: 'RI', id: ri36 }])])).id;
    const f = await one<any>('select * from pp30_filings where id=$1', [id]);
    expect([+f.output_vat, +f.input_vat, f.result, +f.amount, f.seq]).toEqual([385, 144.9, 'payable', 240.1, 0]);
    expect(await entries(f.uv_voucher_id)).toEqual([['17111', 70, 0], ['17112', 74.9, 0], ['17113', 0, 144.9]]);
    expect(await entries(f.jv_voucher_id)).toEqual([['27111', 385, 0], ['17111', 0, 70], ['17112', 0, 74.9], ['27140', 0, 240.1]]);
    expect(await err(db.query(`select file_pp30('2026-10-01',$1::jsonb)`, [j([{ type: 'RI', id: ri30 }])]))).toContain('ถูกใช้ในแบบ ภ.พ.30 แล้ว');
    expect(await err(db.query(`select set_pp36_receipt('RI',$1,'',null)`, [ri36]))).toContain('ใช้สิทธิ์ใน ภ.พ.30 แล้ว');
  });
  it('ยื่นเพิ่มเติม: ภาษีขายเห็นเฉพาะส่วนที่เพิ่มหลังแบบก่อน · ลบแบบคืนเอกสาร', async () => {
    await db.query(`select post_voucher('SV','2026-10-25','ขาย','MANUAL','s3',$1::jsonb)`, [j([{ account: '11311', debit: 107 }, { account: '27111', credit: 7 }, { account: '11112', credit: 100 }])]);
    const id = (await one<any>(`select file_pp30('2026-10-01','[]'::jsonb) id`)).id;
    const f = await one<any>('select * from pp30_filings where id=$1', [id]);
    expect([+f.output_vat, +f.input_vat, f.seq]).toEqual([7, 0, 1]);
    await db.query('select delete_pp30($1)', [id]);
    const first = (await one<any>(`select id from pp30_filings where seq=0 and status='filed'`)).id;
    await db.query('select delete_pp30($1)', [first]);
    expect((await one<any>('select count(*)::int n from pp30_filing_docs')).n).toBe(0);
    await db.query(`select set_pp36_receipt('RI',$1,'',null)`, [ri36]);   // ล้างใบเสร็จได้เมื่อไม่ถูกใช้
  });
});
