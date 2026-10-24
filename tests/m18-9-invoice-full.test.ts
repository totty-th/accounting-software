import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';

const dir = new URL('../supabase/migrations/', import.meta.url);
let db: PGlite; let cust: string, prod: string, svcProd: string;
const ACCOUNTS: [string, string, string][] = [
  ['11112', 'เงินสด', 'asset'], ['11311', 'ลูกหนี้การค้า', 'asset'], ['11319', 'ลูกหนี้อื่น', 'asset'], ['11500', 'สินค้าคงเหลือ', 'asset'],
  ['17120', 'ภาษีถูกหัก ณ ที่จ่าย', 'asset'], ['27111', 'ภาษีขาย', 'liability'], ['41110', 'รายได้ขายสินค้า', 'revenue'],
  ['41210', 'รายได้บริการ', 'revenue'], ['41400', 'รับคืน', 'revenue'], ['21921', 'มัดจำรับ', 'liability'],
];
const D = '2026-10-15';
const err = async (p: Promise<unknown>) => { try { await p; return ''; } catch (e) { return (e as Error).message; } };
const one = async <T = any>(q: string, a: unknown[] = []) => (await db.query<any>(q, a)).rows[0] as T;
const inv = async (h: object, lines: object[]) =>
  (await one<any>('select create_invoice_full($1::jsonb,$2::jsonb) id', [JSON.stringify({ date: D, contact: cust, ...h }), JSON.stringify(lines)])).id as string;
const L = (x: object = {}) => ({ description: 'บริการ', qty: 2, unit_price: 1000, ...x });
const get = (id: string) => one<any>('select * from sales_docs where id=$1', [id]);
const entries = async (v: string) =>
  (await db.query<any>(`select a.code, l.debit, l.credit from journal_lines l join accounts a on a.id=l.account_id where voucher_id=$1 order by a.code`, [v]))
    .rows.map(x => [x.code, +x.debit, +x.credit]);

beforeAll(async () => {
  db = new PGlite();
  for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(new URL(f, dir), 'utf8'));
});
beforeEach(async () => {
  await db.exec(`truncate receipt_items, receipts, billing_note_items, sales_doc_lines, sales_docs, stock_movements, product_stock, products, contacts,
                 journal_lines, journal_vouchers, period_locks, doc_sequences, accounts cascade`);
  for (const [c, n, t] of ACCOUNTS) await db.query('insert into accounts(code,name,type) values ($1,$2,$3)', [c, n, t]);
  cust = (await one<any>(`insert into contacts(business_name,tax_id,credit_days) values ('ลูกค้า ทดสอบ','0105500000001',30) returning id`)).id;
  prod = (await one<any>(`insert into products(code,name,kind,sale_price,base_unit) values ('TST-A','ตะแกรง A','goods_stock',750,'แผ่น') returning id`)).id;
  svcProd = (await one<any>(`insert into products(code,name,kind,sale_price) values ('SV-1','บริการ 1','service',1000) returning id`)).id;
});

describe('M18.9 ใบแจ้งหนี้เต็มรูปแบบ', () => {
  it('ตรงกับ FA: ส่วนลด 10% + VAT 7% + หัก 3% → ลูกหนี้ 1,926 / รายได้ 1,800 / VAT 126 และหัก ณ ที่จ่ายไม่ลงบัญชีตอนออกใบ', async () => {
    const id = await inv({ term_mode: 'credit', credit_days: 30 }, [L({ discount_type: 'percent', discount_value: 10, wht_rate: 3 })]);
    const d = await get(id);
    expect([d.doc_type, d.status, d.doc_no.startsWith('INV'), +d.subtotal, +d.vat, +d.total, +d.discount_total, +d.wht_total])
      .toEqual(['INV', 'awaiting_payment', true, 1800, 126, 1926, 200, 54]);
    expect(await entries(d.voucher_id)).toEqual([['11311', 1926, 0], ['27111', 0, 126], ['41210', 0, 1800]]);
    const l = await one<any>('select * from sales_doc_lines where doc_id=$1', [id]);
    expect([+l.discount, +l.wht, +l.amount, +l.vat_rate]).toEqual([200, 54, 1800, 7]);
  });
  it('เครดิต: คำนวณครบกำหนดจากวันที่ · แก้วันครบกำหนดตรง ๆ แล้วเครดิตเปลี่ยนตาม · ไม่แสดงวันที่ = ไม่มีครบกำหนด', async () => {
    const a = await get(await inv({ credit_days: 30 }, [L()]));
    expect([a.credit_days, a.due_date.toISOString().slice(0, 10)]).toEqual([30, '2026-11-14']);
    const b = await get(await inv({ credit_days: 30, due_date: '2026-11-11' }, [L()]));
    expect([b.credit_days, b.due_date.toISOString().slice(0, 10)]).toEqual([27, '2026-11-11']);
    const c = await get(await inv({ term_mode: 'credit_nodate', credit_days: 27 }, [L()]));
    expect([c.term_mode, c.credit_days, c.due_date]).toEqual(['credit_nodate', 27, null]);
    expect(await err(inv({ due_date: '2026-10-01' }, [L()]))).toMatch(/ไม่ก่อนวันที่/);
    expect(await err(inv({ term_mode: 'cash' }, [L()]))).toMatch(/เงื่อนไขชำระ/);
  });
  it('VAT 0% และยกเว้น: รายได้เต็ม ไม่มี VAT · รวมหลายบรรทัด · ราคารวมภาษี', async () => {
    const id = await inv({}, [L({ qty: 1, unit_price: 1000 }), L({ qty: 1, unit_price: 500, vat: '0' }), L({ qty: 1, unit_price: 200, vat: 'exempt' })]);
    const d = await get(id);
    expect([+d.subtotal, +d.vat, +d.total, +d.exempt_base]).toEqual([1700, 70, 1770, 200]);
    expect(await entries(d.voucher_id)).toEqual([['11311', 1770, 0], ['27111', 0, 70], ['41210', 0, 1700]]);
    const e = await get(await inv({ price_mode: 'inclusive' }, [L({ qty: 1, unit_price: 1070 })]));
    expect([+e.subtotal, +e.vat, +e.total]).toEqual([1000, 70, 1070]);
  });
  it('สินค้านับสต็อก: ตัดสต็อกตอนบันทึก · รายได้แยกบัญชีสินค้า/บริการ · ตามคลังที่เลือก', async () => {
    await db.query(`select stock_in($1, main_warehouse(), 10, 5000, $2::date, 'OPEN', gen_random_uuid(), 'OPEN')`, [prod, '2026-10-01']);
    const id = await inv({}, [{ product_id: prod, description: 'ตะแกรง A', qty: 4, unit_price: 750 }, L({ qty: 1, unit_price: 500 })]);
    expect(+(await one<any>('select stock_on_hand($1,null) v', [prod])).v).toBe(6);
    const d = await get(id);
    expect(await entries(d.voucher_id)).toEqual([['11311', 3745, 0], ['27111', 0, 245], ['41110', 0, 3000], ['41210', 0, 500]]);
    await db.query('select cancel_sales_doc($1)', [id]);
    expect(+(await one<any>('select stock_on_hand($1,null) v', [prod])).v).toBe(10);
  });
  it('รายละเอียดหลายบรรทัด + หน่วย + ชื่อพิมพ์เอง → สร้างสินค้าบริการ (ชื่อซ้ำใช้ตัวเดิม)', async () => {
    const id = await inv({}, [L({ description: 'FREETEXT', detail: 'A\nB', unit: 'งาน', unit_price: 300 })]);
    await inv({}, [L({ description: 'freetext', unit_price: 999 })]);
    const l = await one<any>('select description, detail, unit from sales_doc_lines where doc_id=$1', [id]);
    expect([l.description, l.detail, l.unit]).toEqual(['FREETEXT', 'A\nB', 'งาน']);
    expect((await db.query<any>(`select kind, sale_price from products where lower(name)='freetext'`)).rows.map(p => [p.kind, +p.sale_price])).toEqual([['service', 300]]);
    const v = (await one<any>('select sales_doc_view($1) v', [id])).v;
    expect([v.lines[0].detail, v.lines[0].unit, v.doc.term_mode]).toEqual(['A\nB', 'งาน', 'credit']);
  });
  it('หัวเอกสาร: พนักงานขาย โปรเจกต์ เลขอ้างอิง รายละเอียด หมายเหตุ ลายเซ็น โน้ตภายใน', async () => {
    const d = await get(await inv({ salesperson: 'วิรัศ', project: 'P1', ref_no: 'R-1', description: 'รายละเอียด', note: 'หมายเหตุ', internal_note: 'ภายใน', show_signature: false }, [L()]));
    expect([d.salesperson, d.project, d.ref_no, d.description, d.note, d.internal_note, d.show_signature])
      .toEqual(['วิรัศ', 'P1', 'R-1', 'รายละเอียด', 'หมายเหตุ', 'ภายใน', false]);
  });
  it('ตรวจข้อมูล: ไม่เลือกลูกค้า / ไม่มีรายการ / จำนวน-ราคาผิด / ยอดรวม 0', async () => {
    expect(await err(inv({ contact: '' }, [L()]))).toMatch(/เลือกลูกค้า/);
    expect(await err(inv({}, []))).toMatch(/อย่างน้อย 1 บรรทัด/);
    expect(await err(inv({}, [L({ qty: 0 })]))).toMatch(/จำนวนต้องมากกว่า 0/);
    expect(await err(inv({}, [L({ unit_price: -1 })]))).toMatch(/ไม่ติดลบ/);
    expect(await err(inv({}, [L({ unit_price: 0 })]))).toMatch(/ยอดรวมต้องมากกว่า 0/);
    expect(+(await one<any>(`select count(*) c from sales_docs`)).c).toBe(0);
  });
  it('รับชำระ: หัก ณ ที่จ่ายต่อบรรทัดไปลงตอนรับเงิน (ลูกหนี้ลดเต็ม · เงินเข้าสุทธิ · 17120)', async () => {
    const id = await inv({}, [L({ discount_type: 'percent', discount_value: 10, wht_rate: 3 })]);
    const re = (await one<any>('select create_receipt_from_invoice($1,$2::date) id', [id, D])).id;
    const r = await one<any>('select amount, wht from receipts where id=$1', [re]);
    expect([+r.amount, +r.wht]).toEqual([1926, 54]);
    await db.query('select collect_receipt($1,$2::date)', [re, D]);
    expect((await get(id)).status).toBe('receipt_opened');
  });
  it('แบ่งรับชำระ: หัก ณ ที่จ่ายตามสัดส่วน ครั้งสุดท้ายได้ส่วนที่เหลือ', async () => {
    const id = await inv({}, [L({ wht_rate: 3, qty: 1 })]);   // 1000 + 70 = 1070 · หัก 30
    const r1 = (await one<any>('select create_receipt_from_invoice($1,$2::date,$3) id', [id, D, 535])).id;
    expect(+(await one<any>('select wht from receipts where id=$1', [r1])).wht).toBe(15);
    await db.query('select collect_receipt($1,$2::date)', [r1, D]);
    const r2 = (await one<any>('select create_receipt_from_invoice($1,$2::date) id', [id, D])).id;
    expect(+(await one<any>('select wht from receipts where id=$1', [r2])).wht).toBe(15);
  });
  it('สร้างซ้ำ: เลขใหม่ วันที่ใหม่ คัดลอกหัวและรายการ', async () => {
    const id = await inv({ credit_days: 7, project: 'P', note: 'น' }, [L({ discount_type: 'percent', discount_value: 5, vat: 'exempt', wht_rate: 3, detail: 'ร\nด' })]);
    const cp = (await one<any>('select duplicate_invoice($1,$2::date) id', [id, '2026-10-20'])).id;
    const a = await get(id), b = await get(cp);
    expect([b.doc_no === a.doc_no, b.status, b.doc_date.toISOString().slice(0, 10), b.credit_days, b.project, b.note, +b.total, +b.wht_total, +b.discount_total])
      .toEqual([false, 'awaiting_payment', '2026-10-20', 7, 'P', 'น', +a.total, +a.wht_total, +a.discount_total]);
    expect((await one<any>('select detail from sales_doc_lines where doc_id=$1', [cp])).detail).toBe('ร\nด');
  });
  it('แปลงใบเสนอราคาที่มีส่วนลด/VAT 0%/ยกเว้น/หัก ณ ที่จ่ายเป็นใบแจ้งหนี้ได้ ยอดและบัญชีตรงกับใบเสนอราคา', async () => {
    const q = (await one<any>('select save_quotation(null,$1::jsonb,$2::jsonb) id', [JSON.stringify({ date: D, contact: cust, credit_days: 15, salesperson: 'ส', project: 'P', note: 'น' }),
      JSON.stringify([{ description: 'ก', qty: 2, unit_price: 750, discount_type: 'percent', discount_value: 10, wht_rate: 3 },
        { description: 'ข', qty: 1, unit_price: 500, vat: '0' }, { description: 'ค', qty: 1, unit_price: 200, vat: 'exempt' }])])).id;
    await db.query('select approve_quotation($1)', [q]);
    const i = (await one<any>('select quotation_to_invoice($1,$2::date) id', [q, '2026-10-16'])).id;
    const a = await get(q), b = await get(i);
    expect([+b.subtotal, +b.vat, +b.total, +b.discount_total, +b.exempt_base, +b.wht_total, b.credit_days, b.salesperson, b.project, b.note, b.ref_doc_id, a.status])
      .toEqual([+a.subtotal, +a.vat, +a.total, +a.discount_total, +a.exempt_base, +a.wht_total, 15, 'ส', 'P', 'น', q, 'converted']);
    expect([+b.subtotal, +b.vat, +b.total]).toEqual([2050, 94.5, 2144.5]);   // 1350 + 500 + 200 · VAT เฉพาะบรรทัดแรก
    expect(await entries(b.voucher_id)).toEqual([['11311', +a.total, 0], ['27111', 0, +a.vat], ['41210', 0, +a.subtotal]]);
  });
});
