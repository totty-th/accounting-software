import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';

const dir = new URL('../supabase/migrations/', import.meta.url);
let db: PGlite; let ri: string; let exp0: string;
const one = async <T = any>(q: string, p: unknown[] = []) => (await db.query<any>(q, p)).rows[0] as T;
const err = async (p: Promise<unknown>) => { try { await p; return ''; } catch (e) { return (e as Error).message; } };

beforeAll(async () => {
  db = new PGlite(); for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(new URL(f, dir), 'utf8'));
  await db.exec(`insert into contacts(contact_name, business_name, tax_id) values ('ผู้ขาย','บริษัท ผู้ขาย จำกัด','0105500000001')`);
  const c = (await one<any>(`select id from contacts where contact_name='ผู้ขาย'`)).id;
  ri = (await one<any>(`insert into goods_receipts(ri_no, ri_date, contact_id, status, subtotal, vat, total) values ('RI-T1','2026-10-05',$1,'approved',1000,70,1070) returning id`, [c])).id;
  exp0 = (await one<any>(`insert into goods_receipts(ri_no, ri_date, contact_id, status, subtotal, vat, total) values ('RI-T0','2026-10-05',$1,'approved',1000,0,1000) returning id`, [c])).id;
});
describe('M27.5 สถานะเอกสารภาษีซื้อ', () => {
  it('รับใบกำกับ → มีข้อมูลใบกำกับ · รอยื่น ภ.พ.36 → ตั้งป้าย · กลับเป็นรับใบกำกับ → ล้างป้าย · รอใบกำกับ → ล้างใบกำกับ', async () => {
    await db.query(`select set_purchase_vat_status('RI',$1,'received',$2::jsonb)`, [ri, JSON.stringify({ invoice_no: 'TI-1', invoice_date: '2026-10-06' })]);
    expect((await one<any>('select invoice_no from purchase_tax_invoices where doc_id=$1', [ri])).invoice_no).toBe('TI-1');
    await db.query(`select set_purchase_vat_status('RI',$1,'pp36')`, [ri]);
    expect((await one<any>('select flag from purchase_vat_flags where doc_id=$1', [ri])).flag).toBe('pp36');
    await db.query(`select set_purchase_vat_status('RI',$1,'received',$2::jsonb)`, [ri, JSON.stringify({ invoice_no: 'TI-2' })]);
    expect((await one<any>('select count(*)::int n from purchase_vat_flags where doc_id=$1', [ri])).n).toBe(0);
    await db.query(`select set_purchase_vat_status('RI',$1,'waived')`, [ri]);
    await db.query(`select set_purchase_vat_status('RI',$1,'wait')`, [ri]);
    expect((await one<any>('select count(*)::int n from purchase_tax_invoices where doc_id=$1', [ri])).n).toBe(0);
    expect((await one<any>('select count(*)::int n from purchase_vat_flags where doc_id=$1', [ri])).n).toBe(0);
  });
  it('ปฏิเสธ: เอกสารไม่มี VAT / ไม่พบเอกสาร / สถานะผิด / รับใบกำกับโดยไม่ระบุเลข', async () => {
    expect(await err(db.query(`select set_purchase_vat_status('RI',$1,'waived')`, [exp0]))).toContain('ไม่มี VAT');
    expect(await err(db.query(`select set_purchase_vat_status('RI',gen_random_uuid(),'waived')`))).toContain('ไม่พบเอกสาร');
    expect(await err(db.query(`select set_purchase_vat_status('RI',$1,'zzz')`, [ri]))).toContain('สถานะไม่ถูกต้อง');
    expect(await err(db.query(`select set_purchase_vat_status('RI',$1,'received','{}'::jsonb)`, [ri]))).toContain('เลขที่ใบกำกับ');
  });
});
