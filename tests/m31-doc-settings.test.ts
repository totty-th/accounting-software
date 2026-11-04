import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readdirSync, readFileSync } from 'fs';

let db: PGlite;
const q = async (s: string, p: any[] = []) => (await db.query<any>(s, p)).rows;
beforeAll(async () => {
  db = new PGlite();
  for (const f of readdirSync('supabase/migrations').sort()) await db.exec(readFileSync(`supabase/migrations/${f}`, 'utf8'));
});
describe('เลขที่เอกสาร', () => {
  it('ไม่ตั้งค่า = รูปแบบเดิม', async () => {
    expect((await q(`select next_doc_no('INV', date '2026-11-03', true) n`))[0].n).toBe('INV202611030001');
    expect((await q(`select next_doc_no('JV', date '2026-11-03', false) n`))[0].n).toBe('JV0001');
  });
  it('ตั้ง คำนำหน้า/ปี-เดือน/รีเซ็ตรายเดือน', async () => {
    await q(`select save_doc_number_format('QT','QT-','YYYYMM',3,'monthly')`);
    const a = async (d: string) => (await q(`select next_doc_no('QT', date '${d}', true) n`))[0].n;
    expect(await a('2026-11-03')).toBe('QT-202611001'); expect(await a('2026-11-20')).toBe('QT-202611002');
    expect(await a('2026-12-01')).toBe('QT-202612001');
  });
  it('ห้ามรูปแบบที่เลขซ้ำได้ และคำนำหน้าซ้ำ', async () => {
    await expect(q(`select save_doc_number_format('BL','BL','YYYY',4,'monthly')`)).rejects.toThrow(/รูปแบบเลขที่/);
    await expect(q(`select save_doc_number_format('CA','QT-','YYYYMM',4,'monthly')`)).rejects.toThrow(/ซ้ำ/);
  });
  it('คืนค่าเดิมได้', async () => {
    await q(`select reset_doc_number_format('QT')`);
    expect((await q(`select next_doc_no('QT', date '2026-11-03', true) n`))[0].n).toMatch(/^QT20261103\d{4}$/);
  });
});
describe('ฟังก์ชัน/หมายเหตุเอกสาร', () => {
  it('บันทึกและตรวจชนิดเอกสาร', async () => {
    await q(`select save_doc_settings('{"price_mode":"inclusive","wht_level":"footer","remarks":{"QT":"ราคานี้มีผล 30 วัน"}}')`);
    const s = (await q('select * from doc_settings'))[0];
    expect(s.price_mode).toBe('inclusive'); expect(s.wht_level).toBe('footer'); expect(s.vat_level).toBe('line'); expect(s.remarks.QT).toBe('ราคานี้มีผล 30 วัน');
    await expect(q(`select save_doc_settings('{"remarks":{"XX":"a"}}')`)).rejects.toThrow(/ชนิดเอกสาร/);
  });
});
describe('หมายเหตุเอกสารแบบ FA (save_doc_remarks)', () => {
  it('ALL อย่างเดียว หรือแยกชนิด · ตรวจชนิด/ความยาว · ตัวตั้งต้นใช้ ALL เมื่อไม่มีของชนิดนั้น', async () => {
    await q(`select save_doc_remarks('{"ALL":"ขอบคุณที่ใช้บริการ"}')`);
    const get = async (t: string) => (await q(`select coalesce(remarks->>$1, remarks->>'ALL') v from doc_settings`, [t]))[0].v;
    expect(await get('INV')).toBe('ขอบคุณที่ใช้บริการ'); expect(await get('PO')).toBe('ขอบคุณที่ใช้บริการ');
    await q(`select save_doc_remarks('{"QT":"ราคามีผล 30 วัน","PAY":"แนบสลิป"}')`);
    expect(await get('QT')).toBe('ราคามีผล 30 วัน'); expect(await get('INV')).toBeNull();
    await expect(q(`select save_doc_remarks('{"ALL":"a","QT":"b"}')`)).rejects.toThrow(/อย่างใดอย่างหนึ่ง/);
    await expect(q(`select save_doc_remarks('{"XX":"a"}')`)).rejects.toThrow(/ชนิดเอกสาร/);
    await expect(q(`select save_doc_remarks($1::jsonb)`, [JSON.stringify({ QT: 'ก'.repeat(1001) })])).rejects.toThrow(/1000/);
    await q(`select save_doc_remarks('{}')`);
  });
});
describe('ข้อมูลรับชำระ', () => {
  it('โอนต้องมีธนาคาร/เลขบัญชี/ชื่อบัญชี, เช็คต้องมีผู้รับ', async () => {
    await expect(q(`select save_payment_info(null,'{"kind":"transfer","bank":"กสิกร"}')`)).rejects.toThrow();
    await expect(q(`select save_payment_info(null,'{"kind":"cheque"}')`)).rejects.toThrow();
    const id = (await q(`select save_payment_info(null,'{"kind":"transfer","bank":"กสิกร","account_no":"123","account_name":"บจก.","remark":"แนบสลิป"}') id`))[0].id;
    await q(`select save_payment_info($1,'{"kind":"transfer","bank":"กสิกร","account_no":"123","account_name":"บจก.","is_active":false}')`, [id]);
    expect((await q('select is_active from payment_infos where id=$1', [id]))[0].is_active).toBe(false);
    await q('select remove_payment_info($1)', [id]); expect(await q('select 1 from payment_infos')).toHaveLength(0);
  });
});
describe('สกุลเงิน', () => {
  it('ต้องเปิดหลายสกุลเงินก่อน, ห้าม THB, อัตรา > 0', async () => {
    await expect(q(`select save_currency('USD','ดอลลาร์','$',35,true)`)).rejects.toThrow(/เปิดใช้งาน/);
    await q(`select save_doc_settings('{"multi_currency":true}')`);
    await q(`select save_currency('usd','ดอลลาร์สหรัฐ','$',35.5,true)`);
    expect((await q(`select code, rate from currencies`))[0]).toMatchObject({ code: 'USD', rate: '35.500000' });
    await expect(q(`select save_currency('THB','บาท','฿',1,true)`)).rejects.toThrow(/ไม่ถูกต้อง/);
    await expect(q(`select save_currency('EUR','ยูโร','€',0,true)`)).rejects.toThrow(/ไม่ถูกต้อง/);
  });
});

describe('ระดับ VAT/ส่วนลด/WHT แยกขาย-ซื้อ (0069)', () => {
  it('ค่าตั้งต้น line และตั้งแยกกันได้', async () => {
    let r = (await q(`select vat_level, pur_vat_level, pur_wht_level from doc_settings`))[0];
    expect(r).toMatchObject({ vat_level: 'line', pur_vat_level: 'line', pur_wht_level: 'line' });
    await q(`select save_doc_settings('{"pur_vat_level":"footer","pur_wht_level":"footer"}'::jsonb)`);
    r = (await q(`select vat_level, discount_level, pur_vat_level, pur_discount_level, pur_wht_level from doc_settings`))[0];
    expect(r).toMatchObject({ vat_level: 'line', discount_level: 'line', pur_vat_level: 'footer', pur_discount_level: 'line', pur_wht_level: 'footer' });
  });
  it('ค่าไม่ถูกต้องถูกปฏิเสธ', async () => {
    await expect(q(`select save_doc_settings('{"pur_vat_level":"x"}'::jsonb)`)).rejects.toThrow();
  });
});

describe('คลังหลักตั้งต้น (0071)', () => {
  it('ค่าตั้งต้นเปิด และปิดได้โดยไม่กระทบค่าอื่น', async () => {
    expect((await q(`select default_main_warehouse d from doc_settings`))[0].d).toBe(true);
    await q(`select save_doc_settings('{"default_main_warehouse":false}'::jsonb)`);
    const r = (await q(`select default_main_warehouse d, show_warehouse s, pur_vat_level p from doc_settings`))[0];
    expect(r).toMatchObject({ d: false, s: true, p: 'footer' });
  });
});
