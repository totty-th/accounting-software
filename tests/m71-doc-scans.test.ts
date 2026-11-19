import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';

// M71 บันทึกค่าใช้จ่ายจากรูปบิล/PDF (โมดูลเสริม · เฟสแรกกรอกเอง)
const dir = new URL('../supabase/migrations/', import.meta.url);
let db: PGlite; let v1: string;
const ACCOUNTS: [string, string, string][] = [['11112', 'เงินสด', 'asset'], ['11122', 'ธนาคาร', 'asset'], ['12612', 'ค่าบริการ', 'expense'],
  ['17113', 'ภาษีซื้อ', 'asset'], ['21311', 'เจ้าหนี้การค้า', 'liability'], ['21399', 'เจ้าหนี้อื่น', 'liability']];
const err = async (p: Promise<unknown>) => { try { await p; return ''; } catch (e) { return (e as Error).message; } };
const one = async <T = any>(q: string, a: unknown[] = []) => (await db.query<any>(q, a)).rows[0] as T;
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const add = (mime = 'image/jpeg', data: Uint8Array = JPG, name = 'บิล.jpg') => one<any>(`select doc_scan_add($1,$2,$3) id`, [name, mime, data]).then(r => r.id as string);
const H = (x: object = {}) => JSON.stringify({ date: '2026-11-10', contact: v1, ref_no: 'IV-0099', ...x });
const LINES = JSON.stringify([{ description: 'ค่าบริการ', account: '12612', qty: 1, unit_price: 1000, vat: '7' }]);

beforeAll(async () => {
  db = new PGlite();
  for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(new URL(f, dir), 'utf8'));
});
beforeEach(async () => {
  await db.exec(`truncate doc_scans, expense_lines, expenses, contacts, journal_lines, journal_vouchers, period_locks, doc_sequences, accounts cascade`);
  for (const [c, n, t] of ACCOUNTS) await db.query('insert into accounts(code,name,type) values ($1,$2,$3)', [c, n, t]);
  v1 = (await one<any>(`insert into contacts(business_name) values ('ผู้ขาย ทดสอบ') returning id`)).id;
  await db.query(`update app_modules set enabled = true where key = 'scan'`);
});

describe('M71 โมดูลบันทึกจากเอกสาร', () => {
  it('ค่าเริ่มต้นของโมดูลคือปิด และปิดอยู่จะอัปโหลดไม่ได้', async () => {
    const d = new PGlite();
    for (const f of readdirSync(dir).sort()) await d.exec(readFileSync(new URL(f, dir), 'utf8'));
    expect((await d.query<any>(`select enabled from app_modules where key='scan'`)).rows[0].enabled).toBe(false);
    await db.query(`update app_modules set enabled = false where key = 'scan'`);
    expect(await err(add())).toContain('ยังไม่เปิดใช้งาน');
  });
  it('รับเฉพาะ JPG/PNG/PDF · รูป ≤ 4 MB · ไฟล์ว่างไม่ได้', async () => {
    expect(await err(add('image/gif'))).toContain('JPG, PNG หรือ PDF');
    expect(await err(add('image/png', new Uint8Array(0)))).toContain('ว่างเปล่า');
    expect(await err(add('image/png', new Uint8Array(4194305)))).toContain('4 MB');
    const pdf = await add('application/pdf', new Uint8Array(5_000_000), 'a.pdf');   // PDF ใหญ่กว่า 4 MB ได้
    expect((await one(`select status, size, mime from doc_scans where id=$1`, [pdf]))).toEqual({ status: 'pending', size: 5_000_000, mime: 'application/pdf' });
  });
  it('บันทึกค่าใช้จ่ายจากไฟล์: สร้างค่าใช้จ่าย + ลงบัญชี + ผูกไฟล์และสรุปข้อมูลในธุรกรรมเดียว', async () => {
    const s = await add();
    const exp = (await one(`select doc_scan_save_expense($1,$2::jsonb,$3::jsonb) id`, [s, H(), LINES])).id;
    const e = await one(`select total::float, uv_voucher_id from expenses where id=$1`, [exp]);
    expect(e.total).toBe(1070); expect(e.uv_voucher_id).toBeTruthy();
    expect(await one(`select status, expense_id, scanned_no, vendor_name, total::float, doc_date::text from doc_scans where id=$1`, [s]))
      .toEqual({ status: 'saved', expense_id: exp, scanned_no: 'IV-0099', vendor_name: 'ผู้ขาย ทดสอบ', total: 1070, doc_date: '2026-11-10' });
  });
  it('บันทึกซ้ำไม่ได้ และถ้าค่าใช้จ่ายผิดพลาด ไฟล์ยังรอบันทึก (ไม่มีค่าใช้จ่ายค้าง)', async () => {
    const s = await add();
    await db.query(`select doc_scan_save_expense($1,$2::jsonb,$3::jsonb)`, [s, H(), LINES]);
    expect(await err(db.query(`select doc_scan_save_expense($1,$2::jsonb,$3::jsonb)`, [s, H(), LINES]))).toContain('บันทึกเป็นค่าใช้จ่ายไปแล้ว');
    expect((await one(`select count(*)::int n from expenses`)).n).toBe(1);
    const s2 = await add();
    const bad = JSON.stringify([{ description: 'x', account: '12612', qty: 0, unit_price: 10 }]);
    expect(await err(db.query(`select doc_scan_save_expense($1,$2::jsonb,$3::jsonb)`, [s2, H(), bad]))).not.toBe('');
    expect((await one(`select status, expense_id from doc_scans where id=$1`, [s2]))).toEqual({ status: 'pending', expense_id: null });
    expect((await one(`select count(*)::int n from expenses`)).n).toBe(1);
  });
  it('ยกเลิกไฟล์ → นำกลับได้ · ไฟล์ที่ยกเลิก/บันทึกแล้วยกเลิกซ้ำหรือบันทึกไม่ได้', async () => {
    const s = await add();
    await db.query(`select doc_scan_discard($1)`, [s]);
    expect(await err(db.query(`select doc_scan_save_expense($1,$2::jsonb,$3::jsonb)`, [s, H(), LINES]))).toContain('ถูกยกเลิก');
    await db.query(`select doc_scan_restore($1)`, [s]);
    await db.query(`select doc_scan_save_expense($1,$2::jsonb,$3::jsonb)`, [s, H(), LINES]);
    expect(await err(db.query(`select doc_scan_discard($1)`, [s]))).toContain('ยังไม่บันทึก');
  });
});
