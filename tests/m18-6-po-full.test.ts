import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';

const dir = new URL('../supabase/migrations/', import.meta.url);
let db: PGlite; let v1: string, prod: string;
const ACCOUNTS: [string, string, string][] = [
  ['11112', 'เงินสด', 'asset'], ['11122', 'ธนาคาร', 'asset'], ['11500', 'สินค้าคงเหลือ', 'asset'],
  ['17113', 'ภาษีซื้อ', 'asset'], ['21311', 'เจ้าหนี้การค้า', 'liability'],
];
const D = '2026-10-15';
const err = async (p: Promise<unknown>) => { try { await p; return ''; } catch (e) { return (e as Error).message; } };
const one = async <T = any>(q: string, a: unknown[] = []) => (await db.query<any>(q, a)).rows[0] as T;
const save = async (id: string | null, h: object, lines: object[]) =>
  (await one<any>('select save_purchase_order($1,$2::jsonb,$3::jsonb) id', [id, JSON.stringify({ date: D, contact: v1, ...h }), JSON.stringify(lines)])).id;
const L = (x: object = {}) => ({ product_id: prod, qty: 4, unit_price: 600, ...x });

beforeAll(async () => {
  db = new PGlite();
  for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(new URL(f, dir), 'utf8'));
});
beforeEach(async () => {
  await db.exec(`truncate purchase_order_lines, purchase_orders, stock_alerts, stock_movements, product_stock, goods_receipt_lines,
    goods_receipts, products, contacts, journal_lines, journal_vouchers, period_locks, doc_sequences, accounts cascade`);
  for (const [c, n, t] of ACCOUNTS) await db.query('insert into accounts(code,name,type) values ($1,$2,$3)', [c, n, t]);
  v1 = (await one<any>(`insert into contacts(business_name) values ('ผู้ขาย A') returning id`)).id;
  prod = (await one<any>(`insert into products(code,name,kind,purchase_price,base_unit) values ('TST-A','A','goods_stock',600,'ชิ้น') returning id`)).id;
});

describe('M18.6 ใบสั่งซื้อเต็มรูปแบบ', () => {
  it('หัวเอกสาร: เครดิต→ครบกำหนด, ผู้สั่งซื้อ, อ้างอิง, หน่วยตามสินค้า, ลายเซ็นเริ่มต้นเปิด', async () => {
    const id = await save(null, { credit_days: 30, purchaser: 'สมชาย', ref_no: 'REF-1', project: 'P1', internal_note: 'ภายใน' }, [L()]);
    const p = await one<any>('select * from purchase_orders where id=$1', [id]);
    expect([p.po_no, p.credit_days, String(p.due_date.toISOString().slice(0, 10)), p.purchaser, p.ref_no, p.show_signature, p.internal_note])
      .toEqual(['PO202610150001', 30, '2026-11-14', 'สมชาย', 'REF-1', true, 'ภายใน']);
    expect((await one<any>('select unit from purchase_order_lines where po_id=$1', [id])).unit).toBe('ชิ้น');
    expect(+(await one<any>('select count(*) c from journal_vouchers')).c).toBe(0);
  });
  it('ส่วนลด % และ บาท · VAT 7/0/ยกเว้น · หัก ณ ที่จ่ายต่อบรรทัด', async () => {
    const id = await save(null, {}, [
      L({ discount_type: 'percent', discount_value: 10, wht_rate: 3 }),          // 2400-240=2160, vat 151.20, wht 64.80
      L({ discount_type: 'amount', discount_value: 100, vat: '0' }),             // 2300, vat 0
      L({ vat: 'exempt', qty: 1, unit_price: 500 }),                             // 500 ยกเว้น
    ]);
    const p = await one<any>('select * from purchase_orders where id=$1', [id]);
    expect([+p.subtotal, +p.vat, +p.total, +p.discount_total, +p.exempt_base, +p.wht_total]).toEqual([4960, 151.2, 5111.2, 340, 500, 64.8]);
  });
  it('ราคารวมภาษี (inclusive) แยก VAT ออกจากยอดหลังส่วนลด', async () => {
    const id = await save(null, { price_mode: 'inclusive' }, [L({ qty: 1, unit_price: 1070 })]);
    const p = await one<any>('select * from purchase_orders where id=$1', [id]);
    expect([+p.subtotal, +p.vat, +p.total]).toEqual([1000, 70, 1070]);
  });
  it('แก้ไขได้เฉพาะรออนุมัติ · แก้แล้วคำนวณใหม่เลขเดิม', async () => {
    const id = await save(null, {}, [L()]);
    await save(id, { purchaser: 'ใหม่' }, [L({ qty: 1 })]);
    const p = await one<any>('select * from purchase_orders where id=$1', [id]);
    expect([p.po_no, p.purchaser, +p.total]).toEqual(['PO202610150001', 'ใหม่', 642]);
    expect(+(await one<any>('select count(*) c from purchase_order_lines where po_id=$1', [id])).c).toBe(1);
    await db.query('select approve_purchase_order($1)', [id]);
    expect(await err(save(id, {}, [L()]))).toContain('รออนุมัติ');
  });
  it('ตรวจข้อมูล: ไม่มีผู้จำหน่าย/ส่วนลดเกิน/ภาษีไม่รองรับ', async () => {
    expect(await err(save(null, { contact: '' }, [L()]))).toContain('ผู้จำหน่าย');
    expect(await err(save(null, {}, [L({ discount_type: 'percent', discount_value: 101 })]))).toContain('100');
    expect(await err(save(null, {}, [L({ discount_type: 'amount', discount_value: 99999 })]))).toContain('เกินมูลค่า');
    expect(await err(save(null, {}, [L({ vat: '10' })]))).toContain('ไม่รองรับ');
  });
  it('สร้างซ้ำคัดลอกทุกอย่าง', async () => {
    const id = await save(null, { credit_days: 7, purchaser: 'x' }, [L({ discount_type: 'percent', discount_value: 10, vat: 'exempt', wht_rate: 3, description: 'รายละเอียด' })]);
    const d = (await one<any>('select duplicate_purchase_order($1,$2::date) id', [id, '2026-10-16'])).id;
    const a = await one<any>('select * from purchase_orders where id=$1', [id]);
    const b = await one<any>('select * from purchase_orders where id=$1', [d]);
    expect(b.po_no).toBe('PO202610160001');
    expect([+b.total, +b.discount_total, +b.wht_total, b.credit_days, b.status]).toEqual([+a.total, +a.discount_total, +a.wht_total, 7, 'pending']);
    const l = await one<any>('select * from purchase_order_lines where po_id=$1', [d]);
    expect([l.vat_exempt, l.description, +l.wht_rate]).toEqual([true, 'รายละเอียด', 3]);
  });
  it('แปลง PO→RI ใช้โหมดราคา/ครบกำหนดของ PO · มีส่วนลดแปลงไม่ได้', async () => {
    const id = await save(null, { price_mode: 'inclusive', credit_days: 10 }, [L({ qty: 1, unit_price: 1070 })]);
    const ri = (await one<any>('select upgrade_po_to_ri($1) id', [id])).id;
    const r = await one<any>('select * from goods_receipts where id=$1', [ri]);
    expect([+r.total, +r.subtotal, r.ref_no, String(r.due_date.toISOString().slice(0, 10))]).toEqual([1070, 1000, 'PO202610150001', '2026-10-25']);
    const id2 = await save(null, {}, [L({ discount_type: 'amount', discount_value: 50 })]);
    expect(await err(db.query('select upgrade_po_to_ri($1)', [id2]))).toContain('ส่วนลด');
  });
  it('ลายเซ็น/ตรายางเก็บใน company_profile', async () => {
    await db.query(`insert into company_profile(name,address,tax_id,signature_img,stamp_img) values ('บ','ที่อยู่','0105500000001','data:image/png;base64,AA==','data:image/png;base64,BB==')`);
    expect((await one<any>('select stamp_img from company_profile')).stamp_img).toContain('BB');
  });
});
