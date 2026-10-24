import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';

const dir = new URL('../supabase/migrations/', import.meta.url);
let db: PGlite; let cust: string, prod: string;
const ACCOUNTS: [string, string, string][] = [
  ['11311', 'ลูกหนี้การค้า', 'asset'], ['11319', 'ลูกหนี้อื่น', 'asset'], ['11500', 'สินค้าคงเหลือ', 'asset'], ['27111', 'ภาษีขาย', 'liability'],
  ['41110', 'รายได้ขายสินค้า', 'revenue'], ['41210', 'รายได้บริการ', 'revenue'], ['41400', 'รับคืน', 'revenue'], ['21921', 'มัดจำรับ', 'liability'],
];
const D = '2026-10-15';
const err = async (p: Promise<unknown>) => { try { await p; return ''; } catch (e) { return (e as Error).message; } };
const one = async <T = any>(q: string, a: unknown[] = []) => (await db.query<any>(q, a)).rows[0] as T;
const qt = async (h: object, lines: object[], id: string | null = null) =>
  (await one<any>('select save_quotation($1,$2::jsonb,$3::jsonb) id', [id, JSON.stringify({ date: D, contact: cust, ...h }), JSON.stringify(lines)])).id as string;
const L = (x: object = {}) => ({ description: 'ตะแกรง', qty: 2, unit_price: 750, ...x });
const get = (id: string) => one<any>('select * from sales_docs where id=$1', [id]);
const gl = async () => +(await one<any>('select count(*) c from journal_vouchers')).c;

beforeAll(async () => {
  db = new PGlite();
  for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(new URL(f, dir), 'utf8'));
});
beforeEach(async () => {
  await db.exec(`truncate billing_note_items, sales_doc_lines, sales_docs, stock_movements, product_stock, products, contacts, journal_lines,
                 journal_vouchers, period_locks, doc_sequences, accounts cascade`);
  for (const [c, n, t] of ACCOUNTS) await db.query('insert into accounts(code,name,type) values ($1,$2,$3)', [c, n, t]);
  cust = (await one<any>(`insert into contacts(business_name,tax_id) values ('ลูกค้า ทดสอบ','0105500000001') returning id`)).id;
  prod = (await one<any>(`insert into products(code,name,kind,sale_price,base_unit) values ('TST-A','ตะแกรง A','goods_stock',750,'แผ่น') returning id`)).id;
});

describe('M18.8 ใบเสนอราคาเต็มรูปแบบ', () => {
  it('หัวเอกสารครบ · เลขที่ QT · รออนุมัติ · ไม่ลงบัญชี', async () => {
    const id = await qt({ term_mode: 'credit', credit_days: 30, salesperson: 'วิรัศ', project: 'P1', ref_no: 'R-1', description: 'รายละเอียด',
      note: 'ยืนราคา 30 วัน', internal_note: 'ภายใน', show_signature: false }, [L()]);
    const d = await get(id);
    expect([d.doc_type, d.status, d.doc_no.startsWith('QT'), d.credit_days, d.due_date.toISOString().slice(0, 10), d.salesperson, d.project, d.ref_no,
      d.note, d.internal_note, d.show_signature, +d.subtotal, +d.vat, +d.total])
      .toEqual(['QT', 'pending_approval', true, 30, '2026-11-14', 'วิรัศ', 'P1', 'R-1', 'ยืนราคา 30 วัน', 'ภายใน', false, 1500, 105, 1605]);
    expect(await gl()).toBe(0);
  });
  it('ส่วนลด % และ ฿ · VAT 0/ยกเว้น · หัก ณ ที่จ่ายต่อบรรทัด (ข้อมูลบนเอกสาร)', async () => {
    const id = await qt({}, [L({ discount_type: 'percent', discount_value: 10 }),             // 1500-150=1350 +94.50
      L({ qty: 1, unit_price: 1000, vat: 'exempt', wht_rate: 3 }),                             // 1000 ยกเว้น หัก 30
      L({ qty: 1, unit_price: 500, vat: '0', discount_type: 'amount', discount_value: 100 })]); // 400 vat0
    const d = await get(id);
    expect([+d.subtotal, +d.vat, +d.total, +d.discount_total, +d.exempt_base, +d.wht_total]).toEqual([2750, 94.5, 2844.5, 250, 1000, 30]);
    const ls = (await db.query<any>('select * from sales_doc_lines where doc_id=$1 order by line_no', [id])).rows;
    expect(ls.map(x => [+x.discount, x.vat_exempt, +x.wht, +x.amount])).toEqual([[150, false, 0, 1350], [0, true, 30, 1000], [100, false, 0, 400]]);
  });
  it('ราคารวมภาษี', async () => {
    const id = await qt({ price_mode: 'inclusive' }, [L({ qty: 1, unit_price: 1070 })]);
    const d = await get(id);
    expect([+d.subtotal, +d.vat, +d.total]).toEqual([1000, 70, 1070]);
  });
  it('เงินสด: ไม่มีเครดิต/ครบกำหนด · เครดิตไม่แสดงวันที่ เก็บจำนวนวันไว้', async () => {
    const a = await get(await qt({ term_mode: 'cash', credit_days: 15 }, [L()]));
    expect([a.term_mode, a.credit_days, a.due_date]).toEqual(['cash', 0, null]);
    const b = await get(await qt({ term_mode: 'credit_nodate', credit_days: 15 }, [L()]));
    expect([b.term_mode, b.credit_days, b.due_date]).toEqual(['credit_nodate', 15, null]);
  });
  it('ไม่ต้องมีสินค้าในระบบ (พิมพ์รายการเอง) และอ้างสินค้าได้ หน่วยมาจากสินค้า', async () => {
    const id = await qt({}, [L({ description: 'ค่าบริการติดตั้ง' }), { product_id: prod, qty: 1, unit_price: 750 }]);
    const ls = (await db.query<any>('select description, unit, item_kind from sales_doc_lines where doc_id=$1 order by line_no', [id])).rows;
    expect(ls).toEqual([{ description: 'ค่าบริการติดตั้ง', unit: null, item_kind: 'service' }, { description: 'ตะแกรง A', unit: 'แผ่น', item_kind: 'goods' }]);
  });
  it('ตรวจข้อมูล', async () => {
    expect(await err(qt({ contact: '' }, [L()]))).toMatch(/ลูกค้า/);
    expect(await err(qt({}, []))).toMatch(/อย่างน้อย 1/);
    expect(await err(qt({}, [L({ description: '' })]))).toMatch(/รายการหรือรายละเอียด/);
    expect(await err(qt({}, [L({ qty: 0 })]))).toMatch(/จำนวน/);
    expect(await err(qt({}, [L({ discount_type: 'percent', discount_value: 101 })]))).toMatch(/ส่วนลดเกิน/);
    expect(await err(qt({}, [L({ discount_type: 'amount', discount_value: 99999 })]))).toMatch(/ส่วนลดเกิน/);
    expect(await err(qt({}, [L({ vat: '5' })]))).toMatch(/ไม่รองรับ/);
    expect(await err(qt({ term_mode: 'x' }, [L()]))).toMatch(/เงื่อนไขชำระ/);
    expect(+(await one<any>('select count(*) c from sales_docs')).c).toBe(0);
  });
  it('แก้ไขได้เฉพาะรออนุมัติ · เลขที่เดิม · แทนที่รายการ', async () => {
    const id = await qt({}, [L(), L({ description: 'อีกชิ้น' })]);
    const no = (await get(id)).doc_no;
    await qt({ note: 'แก้แล้ว' }, [L({ qty: 1 })], id);
    const d = await get(id);
    expect([d.doc_no, d.note, +d.total, +(await one<any>('select count(*) c from sales_doc_lines where doc_id=$1', [id])).c]).toEqual([no, 'แก้แล้ว', 802.5, 1]);
    await db.query('select approve_quotation($1)', [id]);
    expect(await err(qt({}, [L()], id))).toMatch(/รออนุมัติ/);
  });
  it('ไม่อนุมัติ → รีเซ็ต → อนุมัติ · รีเซ็ตจากอนุมัติแล้ว · ห้ามเมื่อมี INV ผูก', async () => {
    const id = await qt({}, [L()]);
    await db.query('select reject_quotation($1)', [id]);
    expect((await get(id)).status).toBe('rejected');
    expect(await err(db.query('select approve_quotation($1)', [id]))).toMatch(/รออนุมัติ/);
    await db.query('select reset_quotation($1)', [id]);
    expect((await get(id)).status).toBe('pending_approval');
    await db.query('select approve_quotation($1)', [id]);
    await db.query('select reset_quotation($1)', [id]);
    await db.query('select approve_quotation($1)', [id]);
    const inv = (await one<any>('select quotation_to_invoice($1,$2::date) id', [id, D])).id;
    expect((await get(id)).status).toBe('converted');
    expect(await err(db.query('select reject_quotation($1)', [id]))).toMatch(/ไม่อนุมัติได้เฉพาะ/);
    expect(await err(db.query('select reset_quotation($1)', [id]))).toMatch(/ใบแจ้งหนี้ผูกอยู่/);
    expect(+(await get(inv)).total).toBe(1605);
  });
  it('สร้างซ้ำ: เลขใหม่ สถานะรออนุมัติ คัดลอกหัวและรายการ', async () => {
    const id = await qt({ term_mode: 'credit', credit_days: 7, project: 'P', note: 'น' }, [L({ discount_type: 'percent', discount_value: 5, vat: 'exempt', wht_rate: 3 })]);
    await db.query('select approve_quotation($1)', [id]);
    const cp = (await one<any>('select duplicate_quotation($1,$2::date) id', [id, '2026-10-20'])).id;
    const a = await get(id), b = await get(cp);
    expect([b.doc_no === a.doc_no, b.status, b.doc_date.toISOString().slice(0, 10), b.credit_days, b.project, b.note, +b.total, +b.wht_total, +b.discount_total])
      .toEqual([false, 'pending_approval', '2026-10-20', 7, 'P', 'น', +a.total, +a.wht_total, +a.discount_total]);
  });
  it('แปลงเป็นใบแจ้งหนี้: กันเมื่อมีส่วนลด/ภาษีไม่ใช่ 7%/หัก ณ ที่จ่าย', async () => {
    for (const x of [{ discount_type: 'percent', discount_value: 5 }, { vat: '0' }, { vat: 'exempt' }, { wht_rate: 3 }]) {
      const id = await qt({}, [L(x)]);
      await db.query('select approve_quotation($1)', [id]);
      expect(await err(db.query('select quotation_to_invoice($1,$2::date)', [id, D]))).toMatch(/ยังไม่รองรับ/);
      expect((await get(id)).status).toBe('approved');
    }
    expect(+(await one<any>(`select count(*) c from sales_docs where doc_type='INV'`)).c).toBe(0);
  });
  it('มุมมองเอกสาร (sales_doc_view) ส่งฟิลด์ใหม่ครบ', async () => {
    const id = await qt({ term_mode: 'cash', salesperson: 'ส', note: 'ห' }, [L({ discount_type: 'percent', discount_value: 10, wht_rate: 3, unit: 'แผ่น' })]);
    const v = (await one<any>('select sales_doc_view($1) v', [id])).v;
    expect([v.doc.term_mode, v.doc.salesperson_name, v.doc.note, +v.doc.discount_total, +v.doc.wht_total, +v.lines[0].discount, +v.lines[0].wht_rate, v.lines[0].unit])
      .toEqual(['cash', 'ส', 'ห', 150, 40.5, 150, 3, 'แผ่น']);
  });
  it('ชื่อที่พิมพ์เอง → สร้างสินค้าบริการให้ตอนบันทึก (ตาม FA) และใช้ตัวเดิมถ้าชื่อซ้ำ', async () => {
    await qt({}, [L({ description: 'FREETEXT', unit_price: 300 })]);
    await qt({}, [L({ description: 'freetext', unit_price: 999 })]);
    const ps = (await db.query<any>(`select name, kind, sale_price from products where lower(name)='freetext'`)).rows;
    expect(ps.map(p => [p.name, p.kind, +p.sale_price])).toEqual([['FREETEXT', 'service', 300]]);
  });
  it('รายละเอียดหลายบรรทัด (detail) แยกจากชื่อ · แปลงเป็นใบแจ้งหนี้รวมเข้ากับชื่อ · สร้างซ้ำคัดลอก detail', async () => {
    const id = await qt({}, [{ product_id: prod, description: 'ตะแกรง A', detail: 'บรรทัดที่หนึ่ง\nบรรทัดที่สอง', qty: 1, unit_price: 750 }]);
    const l = (await one<any>('select description, detail from sales_doc_lines where doc_id=$1', [id]));
    expect([l.description, l.detail]).toEqual(['ตะแกรง A', 'บรรทัดที่หนึ่ง\nบรรทัดที่สอง']);
    const v = (await one<any>('select sales_doc_view($1) v', [id])).v;
    expect(v.lines[0].detail).toBe('บรรทัดที่หนึ่ง\nบรรทัดที่สอง');
    const cp = (await one<any>('select duplicate_quotation($1,$2::date) id', [id, D])).id;
    expect((await one<any>('select detail from sales_doc_lines where doc_id=$1', [cp])).detail).toBe('บรรทัดที่หนึ่ง\nบรรทัดที่สอง');
    await db.query('select approve_quotation($1)', [id]);
    const inv = (await one<any>('select quotation_to_invoice($1,$2::date) id', [id, D])).id;
    expect((await one<any>('select description from sales_doc_lines where doc_id=$1', [inv])).description).toBe('ตะแกรง A\nบรรทัดที่หนึ่ง\nบรรทัดที่สอง');
  });
  it('สินค้ามีรายละเอียด (products.description)', async () => {
    await db.query(`update products set description='รายละเอียดจากสินค้า' where id=$1`, [prod]);
    expect((await one<any>('select description from products where id=$1', [prod])).description).toBe('รายละเอียดจากสินค้า');
  });
});
