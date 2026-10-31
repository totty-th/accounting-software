import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';

const dir = new URL('../supabase/migrations/', import.meta.url);
let db: PGlite; let ri: string;
const one = async <T = any>(q: string, p: unknown[] = []) => (await db.query<any>(q, p)).rows[0] as T;
const err = async (p: Promise<unknown>) => { try { await p; return ''; } catch (e) { return (e as Error).message; } };
const entries = async (v: string) => (await db.query<any>(`select a.code, l.debit::float8 d, l.credit::float8 c from journal_lines l join accounts a on a.id=l.account_id where voucher_id=$1 order by line_no`, [v])).rows.map(x => [x.code, x.d, x.c]);
const bal = async (code: string) => (await one<any>(`select coalesce(sum(l.debit-l.credit),0)::float8 b from journal_lines l join accounts a on a.id=l.account_id where a.code=$1`, [code])).b;

beforeAll(async () => {
  db = new PGlite(); for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(new URL(f, dir), 'utf8'));
  await db.exec(`insert into accounts(code,name,type) values ('51111','ซื้อสินค้า','expense'),('17113','ภาษีซื้อยังไม่ถึงกำหนด','asset'),('27140','เจ้าหนี้สรรพากร','liability'),('21399','เจ้าหนี้','liability'),('11112','ธนาคาร','asset')`);
  await db.exec(`insert into contacts(contact_name, business_name) values ('ต่างประเทศ','Foreign Co')`);
  const c = (await one<any>(`select id from contacts limit 1`)).id;
  const uv = (await one<any>(`select post_voucher('UV','2026-10-23','ซื้อต่างประเทศ','MANUAL','x','[{"account":"51111","debit":1000},{"account":"17113","debit":70},{"account":"21399","credit":1070}]'::jsonb) v`)).v;
  ri = (await one<any>(`insert into goods_receipts(ri_no, ri_date, contact_id, status, subtotal, vat, total, uv_voucher_id) values ('RI-F1','2026-10-23',$1,'approved',1000,70,1070,$2) returning id`, [c, uv])).id;
});
describe('M27.5 ภ.พ.36', () => {
  it('ใบกำกับ ภ.พ.36: ฐาน = ยอดจ่ายจริง 1,070 → VAT 74.90', async () => {
    await db.query(`select set_purchase_tax_invoice('RI',$1,$2::jsonb)`, [ri, JSON.stringify({ invoice_no: 'F-1', invoice_date: '2026-10-23', vat_form: 'PP36' })]);
    const t = await one<any>('select base_amount::float8 b, vat_amount::float8 v from purchase_tax_invoices where doc_id=$1', [ri]);
    expect([t.b, t.v]).toEqual([1070, 74.9]);
  });
  it('ยื่นแบบ: UV ตัด VAT เดิมเป็นต้นทุน + JV ภาษี ภ.พ.36 สิ้นเดือน · 17113 คงเหลือ 74.90 · ชำระ/รีเซ็ต/ลบ (-R)', async () => {
    const id = (await one<any>(`select file_pp36('2026-10-01',$1::jsonb) id`, [JSON.stringify([{ type: 'RI', id: ri }])])).id;
    const f = await one<any>('select * from pp36_filings where id=$1', [id]);
    expect([+f.base_amount, +f.vat_amount]).toEqual([1070, 74.9]);
    expect(await entries(f.uv_voucher_id)).toEqual([['51111', 70, 0], ['17113', 0, 70]]);
    expect(await entries(f.jv_voucher_id)).toEqual([['17113', 74.9, 0], ['27140', 0, 74.9]]);
    expect(await bal('17113')).toBe(74.9);
    expect(await err(db.query(`select file_pp36('2026-10-01',$1::jsonb)`, [JSON.stringify([{ type: 'RI', id: ri }])]))).toContain('อยู่ในแบบ ภ.พ.36 แล้ว');
    expect(await err(db.query(`select set_purchase_tax_invoice('RI',$1,'{"invoice_no":"X"}'::jsonb)`, [ri]))).toContain('ยื่นแล้ว');
    const pv = (await one<any>(`select pay_pp36($1,'2026-11-05'::date) v`, [id])).v;
    expect(await entries(pv)).toEqual([['27140', 74.9, 0], ['11112', 0, 74.9]]);
    expect(await err(db.query(`select delete_pp36($1)`, [id]))).toContain('รีเซ็ตการชำระก่อน');
    await db.query('select reset_pp36_payment($1)', [id]);
    await db.query('select delete_pp36($1)', [id]);
    expect(await bal('17113')).toBe(70); expect(await bal('27140')).toBe(0);
    expect((await one<any>('select count(*)::int n from pp36_filing_docs')).n).toBe(0);
  });
  it('ปฏิเสธ: ไม่มีใบกำกับ ภ.พ.36 / เดือนไม่ตรง / ไม่เลือกเอกสาร', async () => {
    expect(await err(db.query(`select file_pp36('2026-11-01',$1::jsonb)`, [JSON.stringify([{ type: 'RI', id: ri }])]))).toContain('ไม่ได้ลงวันที่ในเดือน');
    expect(await err(db.query(`select file_pp36('2026-10-01','[]'::jsonb)`))).toContain('อย่างน้อย 1');
    expect(await err(db.query(`select file_pp36('2026-10-01',$1::jsonb)`, [JSON.stringify([{ type: 'RI', id: '00000000-0000-0000-0000-000000000000' }])]))).toContain('ไม่มีใบกำกับ');
  });
  it('M27.10: เอกสารที่รายการไม่มี VAT (0%) ยื่น ภ.พ.36 ไม่ได้ ได้ข้อความไทย ไม่ใช่ error ฐานข้อมูล', async () => {
    const c = (await one<any>(`select id from contacts limit 1`)).id;
    const uv = (await one<any>(`select post_voucher('UV','2026-10-24','ต่างประเทศไม่มี VAT','MANUAL','y','[{"account":"51111","debit":2000},{"account":"21399","credit":2000}]'::jsonb) v`)).v;
    const r0 = (await one<any>(`insert into goods_receipts(ri_no, ri_date, contact_id, status, subtotal, vat, total, uv_voucher_id) values ('RI-F2','2026-10-24',$1,'approved',2000,0,2000,$2) returning id`, [c, uv])).id;
    await db.query(`select set_purchase_tax_invoice('RI',$1,$2::jsonb)`, [r0, JSON.stringify({ invoice_no: 'F-2', invoice_date: '2026-10-24', vat_form: 'PP36' })]);
    expect(await err(db.query(`select file_pp36('2026-10-01',$1::jsonb)`, [JSON.stringify([{ type: 'RI', id: r0 }])]))).toContain('ไม่มีภาษีซื้อ ภ.พ.36');
    expect((await one<any>('select count(*)::int n from pp36_filing_docs where doc_id=$1', [r0])).n).toBe(0);   // ฟังก์ชันล้มเหลวทั้งชุด ไม่ทิ้งแบบค้าง
  });
});
