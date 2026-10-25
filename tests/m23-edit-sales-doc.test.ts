import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';

const dir = new URL('../supabase/migrations/', import.meta.url);
let db: PGlite; let cust: string, prod: string;
const ACCOUNTS: [string, string, string][] = [
  ['11112', 'เงินสด', 'asset'], ['11311', 'ลูกหนี้การค้า', 'asset'], ['11319', 'ลูกหนี้อื่น', 'asset'], ['11500', 'สินค้าคงเหลือ', 'asset'],
  ['17120', 'ภาษีถูกหัก ณ ที่จ่าย', 'asset'], ['27111', 'ภาษีขาย', 'liability'], ['41110', 'รายได้ขายสินค้า', 'revenue'],
  ['41210', 'รายได้บริการ', 'revenue'], ['41400', 'รับคืน', 'revenue'], ['21921', 'มัดจำรับ', 'liability'],
];
const D = '2026-10-15';
const err = async (p: Promise<unknown>) => { try { await p; return ''; } catch (e) { return (e as Error).message; } };
const one = async <T = any>(q: string, a: unknown[] = []) => (await db.query<any>(q, a)).rows[0] as T;
const H = (x: object = {}) => JSON.stringify({ date: D, contact: cust, ...x });
const inv = async (lines: object[], type = 'INV', h: object = {}) =>
  (await one<any>('select create_invoice_full($1::jsonb,$2::jsonb,null,$3) id', [H(h), JSON.stringify(lines), type])).id as string;
const upd = (id: string, lines: object[], h: object = {}) => one('select update_sales_doc($1,$2::jsonb,$3::jsonb)', [id, H(h), JSON.stringify(lines)]);
const L = (x: object = {}) => ({ description: 'บริการ', qty: 2, unit_price: 1000, ...x });
const get = (id: string) => one<any>('select * from sales_docs where id=$1', [id]);
const entries = async (v: string) =>
  (await db.query<any>(`select a.code, l.debit, l.credit from journal_lines l join accounts a on a.id=l.account_id where voucher_id=$1 order by a.code`, [v]))
    .rows.map(x => [x.code, +x.debit, +x.credit]);
const onHand = async () => +(await one<any>('select stock_on_hand($1) q', [prod])).q;

beforeAll(async () => {
  db = new PGlite();
  for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(new URL(f, dir), 'utf8'));
});
beforeEach(async () => {
  await db.exec(`truncate voucher_edits, doc_events, receipt_items, receipts, billing_note_items, sales_doc_lines, sales_docs, stock_movements, product_stock, products, contacts,
                 journal_lines, journal_vouchers, period_locks, doc_sequences, accounts cascade`);
  for (const [c, n, t] of ACCOUNTS) await db.query('insert into accounts(code,name,type) values ($1,$2,$3)', [c, n, t]);
  cust = (await one<any>(`insert into contacts(business_name,tax_id,credit_days) values ('ลูกค้า ทดสอบ','0105500000001',30) returning id`)).id;
  prod = (await one<any>(`insert into products(code,name,kind,sale_price,base_unit) values ('TST-A','ตะแกรง A','goods_stock',750,'แผ่น') returning id`)).id;
  await db.query(`select stock_in($1, main_warehouse(), 10, 5000, '2026-10-01', 'RI', gen_random_uuid(), 'OPEN')`, [prod]);
});

describe('M23 แก้ไขเอกสารขาย (แบบ FA)', () => {
  it('INV ที่ยังไม่มีเอกสารผูก: แก้ทับใบสำคัญเดิมที่เลขเดิม ไม่มี -R และเก็บก่อน-หลัง', async () => {
    const id = await inv([L({ qty: 1, unit_price: 10000 })]);
    const a = await get(id);
    await upd(id, [L({ qty: 3, unit_price: 10000 })]);
    const b = await get(id);
    expect(b.doc_no).toBe(a.doc_no); expect(b.voucher_id).toBe(a.voucher_id); expect(+b.total).toBe(32100);
    expect(await entries(b.voucher_id)).toEqual([['11311', 32100, 0], ['27111', 0, 2100], ['41210', 0, 30000]]);
    expect(+(await one<any>(`select count(*) c from journal_vouchers where voucher_no like '%-R'`)).c).toBe(0);
    const e = await one<any>('select before, after from voucher_edits where voucher_id=$1', [a.voucher_id]);
    expect(e.before.lines[0]).toMatchObject({ account: '11311', debit: 10700 }); expect(e.after.lines[0]).toMatchObject({ debit: 32100 });
    const ev = await one<any>(`select detail from doc_events where doc_id=$1 and event='edit'`, [id]);
    const d = JSON.parse(ev.detail); expect(d.mode).toBe('full'); expect(d.before.total).toBe(10700); expect(d.after.total).toBe(32100);
  });

  it('ไม่มีการเปลี่ยนแปลง = บันทึกไม่ได้', async () => {
    const id = await inv([L()]);
    expect(await err(upd(id, [L()]))).toContain('ไม่พบการเปลี่ยนแปลง');
  });

  it('ยังห้ามแก้ใบสำคัญตรง ๆ นอกฟังก์ชันแก้เอกสาร', async () => {
    const id = await inv([L()]); const v = (await get(id)).voucher_id;
    expect(await err(db.query('update journal_lines set debit=1 where voucher_id=$1', [v]))).toContain('แก้ไขหรือลบไม่ได้');
    expect(await err(db.query('delete from journal_vouchers where id=$1', [v]))).toContain('แก้ไขหรือลบไม่ได้');
  });

  it('สต็อก: แก้จำนวนแล้วปรับตามส่วนต่าง · ยกเลิกแล้วคืนครบ', async () => {
    const start = await onHand();
    const id = await inv([{ product_id: prod, qty: 2, unit_price: 750 }]);
    expect(await onHand()).toBe(start - 2);
    await upd(id, [{ product_id: prod, qty: 5, unit_price: 750 }]);
    expect(await onHand()).toBe(start - 5);
    await upd(id, [{ product_id: prod, qty: 1, unit_price: 750 }]);
    expect(await onHand()).toBe(start - 1);
    await db.query('select cancel_sales_doc($1)', [id]);
    expect(await onHand()).toBe(start);
  });

  it('ขายสด (รอเก็บเงิน) แก้ได้ · เก็บเงินแล้วแก้รายการไม่ได้', async () => {
    const id = await inv([L({ qty: 1, unit_price: 3000 })], 'CA');
    await upd(id, [L({ qty: 2, unit_price: 3000 })]);
    expect(await entries((await get(id)).voucher_id)).toEqual([['11319', 6420, 0], ['27111', 0, 420], ['41210', 0, 6000]]);
    await db.query('select collect_cash_sale($1,$2::date)', [id, D]);
    await upd(id, [L({ qty: 9, unit_price: 3000 })], { note: 'เพิ่มหมายเหตุ' });
    const d = await get(id); expect(+d.total).toBe(6420); expect(d.note).toBe('เพิ่มหมายเหตุ');
  });

  it('มีเอกสารผูก (CN / ใบเสร็จ / ใบวางบิล): แก้ได้เฉพาะข้อมูลทั่วไป ยอดไม่เปลี่ยน', async () => {
    const a = await inv([L()]);
    await db.query(`select create_sales_doc('CN',$1::date,$2,$3::jsonb,'exclusive',7,$4,'คืน')`, [D, cust, JSON.stringify([{ description: 'คืน', qty: 1, unit_price: 500 }]), a]);
    expect((await one<any>('select sales_doc_fully_editable($1) f', [a])).f).toBe(false);
    await upd(a, [L({ qty: 9 })], { note: 'หมายเหตุใหม่', ref_no: 'PO-9' });
    const d = await get(a); expect(+d.total).toBe(2140); expect([d.note, d.ref_no]).toEqual(['หมายเหตุใหม่', 'PO-9']);
    const b = await inv([L()]);
    await db.query('select create_receipt_from_invoice($1,$2::date)', [b, D]);
    expect((await one<any>('select sales_doc_fully_editable($1) f', [b])).f).toBe(false);
  });

  it('วันที่ใหม่/เดิมอยู่ในงวดล็อกไม่ได้ · ใบสำคัญเปลี่ยนวันที่ตามเอกสาร', async () => {
    const id = await inv([L()]);
    await upd(id, [L()], { date: '2026-10-16' });
    expect(String((await one<any>('select voucher_date d from journal_vouchers where id=$1', [(await get(id)).voucher_id])).d)).toContain('2026');
    await db.query(`insert into period_locks(date_from,date_to,reason) values ('2026-10-01','2026-10-20','ปิดงวด')`);
    expect(await err(upd(id, [L({ qty: 5 })]))).toContain('PERIOD_LOCKED');
  });

  it('INV จาก QT: แก้ยอดแล้ว QT คำนวณสถานะใหม่ (ไม่กันยอดเกิน ตาม FA)', async () => {
    const q = (await one<any>('select save_quotation(null,$1::jsonb,$2::jsonb) id', [H({ credit_days: 30 }), JSON.stringify([L()])])).id as string;
    await db.query('select approve_quotation($1)', [q]);
    const i = (await one<any>('select quotation_bill($1,$2,$3::date,$4,null,null) id', [q, 'INV', D, 'all'])).id as string;
    expect((await get(q)).status).toBe('converted');
    await upd(i, [L({ qty: 1 })]);
    expect((await get(q)).status).toBe('partial');
    await upd(i, [L({ qty: 5 })]);
    expect((await get(q)).status).toBe('converted');
  });
});
