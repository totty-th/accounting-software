import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';

const dir = new URL('../supabase/migrations/', import.meta.url);
let db: PGlite;
let cust: string;

const ACCOUNTS: [string, string, string][] = [
  ['11112', 'เงินสด', 'asset'], ['11311', 'ลูกหนี้', 'asset'], ['11319', 'ใบเสร็จรอเรียกเก็บ', 'asset'],
  ['27111', 'ภาษีขาย', 'liability'], ['41110', 'รายได้ขายสินค้า', 'revenue'], ['41210', 'รายได้บริการ', 'revenue'],
  ['41400', 'รับคืนและส่วนลด', 'revenue'],
];
const svc = (price: number) => [{ description: 'บริการ', kind: 'service', qty: 1, unit_price: price }];
const err = async (p: Promise<unknown>) => { try { await p; return ''; } catch (e) { return (e as Error).message; } };

async function doc(type: string, date: string, lines: object[], extra: Record<string, unknown> = {}) {
  const r = await db.query<{ id: string }>(
    `select create_sales_doc($1,$2::date,$3,$4::jsonb,$5,7,$6,$7) as id`,
    [type, date, extra.contact ?? cust, JSON.stringify(lines), extra.mode ?? 'exclusive', extra.ref ?? null, extra.reason ?? null]);
  return r.rows[0].id;
}
const get = async (id: string) =>
  (await db.query<any>('select * from sales_docs where id=$1', [id])).rows[0];
async function entries(voucherId: string) {
  const r = await db.query<{ code: string; debit: string; credit: string }>(
    `select a.code, l.debit, l.credit from journal_lines l join accounts a on a.id=l.account_id
      where voucher_id=$1 order by line_no`, [voucherId]);
  return r.rows.map(x => [x.code, +x.debit, +x.credit]);
}
const vno = async (id: string) =>
  (await db.query<any>('select voucher_no from journal_vouchers where id=$1', [id])).rows[0].voucher_no;

beforeAll(async () => {
  db = new PGlite();
  for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(new URL(f, dir), 'utf8'));
});
beforeEach(async () => {
  await db.exec(`truncate billing_note_items, sales_doc_lines, sales_docs, contacts, journal_lines,
                 journal_vouchers, period_locks, doc_sequences, accounts cascade`);
  for (const [c, n, t] of ACCOUNTS) await db.query('insert into accounts(code,name,type) values ($1,$2,$3)', [c, n, t]);
  cust = (await db.query<{ id: string }>(`insert into contacts(business_name,tax_id) values ('บริษัท ทดสอบ จำกัด','0105500000001') returning id`)).rows[0].id;
});

describe('MST ลูกค้า', () => {
  it('MST-01 ต้องมีชื่อธุรกิจหรือชื่อผู้ติดต่อ', async () => {
    expect(await err(db.query(`insert into contacts(tax_id) values (null)`))).toBeTruthy();
    await expect(db.query(`insert into contacts(contact_name) values ('สมชาย')`)).resolves.toBeTruthy();
  });
  it('MST-02 เลขผู้เสียภาษี 10 หรือ 13 หลัก', async () => {
    expect(await err(db.query(`insert into contacts(business_name,tax_id) values ('x','12345')`))).toBeTruthy();
    expect(await err(db.query(`insert into contacts(business_name,tax_id) values ('x','12345678901a3')`))).toBeTruthy();
    await expect(db.query(`insert into contacts(business_name,tax_id) values ('x','1234567890')`)).resolves.toBeTruthy();
  });
});

describe('SAL-02 ใบแจ้งหนี้ (AT-01)', () => {
  it('บริการ 10,000 + VAT 7% ลงบัญชีทันที', async () => {
    const id = await doc('INV', '2026-10-15', svc(10000));
    const d = await get(id);
    expect(d.doc_no).toBe('INV202610150001');
    expect(d.status).toBe('awaiting_payment');
    expect([+d.subtotal, +d.vat, +d.total]).toEqual([10000, 700, 10700]);
    expect(await entries(d.voucher_id)).toEqual([['11311', 10700, 0], ['41210', 0, 10000], ['27111', 0, 700]]);
  });
  it('สินค้าใช้บัญชีรายได้ 41110 / ผสมสินค้าและบริการแยกบัญชี', async () => {
    const id = await doc('INV', '2026-10-15', [
      { description: 'ตะแกรง', kind: 'goods', qty: 3, unit_price: 1000 }, ...svc(500)]);
    const d = await get(id);
    expect(await entries(d.voucher_id)).toEqual([
      ['11311', 3745, 0], ['41110', 0, 3000], ['41210', 0, 500], ['27111', 0, 245]]);
  });
  it('ACC-07 ราคารวม VAT: 10,700 → ฐาน 10,000 VAT 700', async () => {
    const id = await doc('INV', '2026-10-15', svc(10700), { mode: 'inclusive' });
    const d = await get(id);
    expect([+d.subtotal, +d.vat, +d.total]).toEqual([10000, 700, 10700]);
    expect(await entries(d.voucher_id)).toEqual([['11311', 10700, 0], ['41210', 0, 10000], ['27111', 0, 700]]);
  });
  it('ล็อกงวดบล็อกตอนบันทึก INV และไม่เหลือเอกสารค้าง', async () => {
    const past = (d: number) => new Date(Date.now() + 7 * 36e5 - d * 864e5).toISOString().slice(0, 10);
    await db.query('select lock_period($1::date,$2::date,$3)', [past(20), past(5), 'ปิดงวด']);
    expect(await err(doc('INV', past(10), svc(100)))).toContain('PERIOD_LOCKED');
    expect((await db.query('select 1 from sales_docs')).rows).toHaveLength(0);
  });
  it('เลขเอกสารตามวันที่เอกสาร ใบที่สองของวันเดียวกันลงท้าย 0002 (AT-08)', async () => {
    await doc('INV', '2026-10-15', svc(1));
    const b = await get(await doc('INV', '2026-10-15', svc(1)));
    expect(b.doc_no).toBe('INV202610150002');
  });
});

describe('SAL-01 ใบเสนอราคา', () => {
  it('QT ไม่มีรายการบัญชี → อนุมัติ → สร้าง INV → QT "ดำเนินการแล้ว"', async () => {
    const qt = await doc('QT', '2026-10-15', svc(1000));
    expect((await get(qt)).voucher_id).toBeNull();
    // M18.11: สร้างใบแจ้งหนี้จาก QT ที่ยังรออนุมัติได้เลย (ตาม FA) — ดูเทสต์ m18-11
    await db.query('select approve_quotation($1)', [qt]);
    const inv = (await db.query<{ id: string }>('select quotation_to_invoice($1,$2::date) as id', [qt, '2026-10-16'])).rows[0].id;
    expect((await get(qt)).status).toBe('converted');
    const i = await get(inv);
    expect([i.ref_doc_id, +i.total]).toEqual([qt, 1070]);
  });
});

describe('SAL-04 ใบวางบิล', () => {
  it('ไม่มีรายการบัญชี และ INV ยังเป็นรอเก็บเงิน', async () => {
    const a = await doc('INV', '2026-10-15', svc(1000));
    const b = await doc('INV', '2026-10-15', svc(2000));
    const bl = (await db.query<{ id: string }>('select create_billing_note($1::date,$2,$3) as id',
      ['2026-10-16', cust, [a, b]])).rows[0].id;
    const d = await get(bl);
    expect([d.voucher_id, d.status, +d.total]).toEqual([null, 'billed', 3210]);
    expect((await get(a)).status).toBe('awaiting_payment');
    await db.query('select cancel_sales_doc($1)', [bl]);
    expect((await get(bl)).status).toBe('cancelled');
  });
});

describe('SAL-05 ใบลดหนี้', () => {
  it('SV อนุมัติทันที Dr 41400 + 27111 / Cr 11311', async () => {
    const inv = await doc('INV', '2026-10-15', svc(10000));
    const cn = await get(await doc('CN', '2026-10-16', svc(1000), { ref: inv, reason: 'ลดราคาบริการ' }));
    expect(cn.status).toBe('approved');
    expect(await entries(cn.voucher_id)).toEqual([['41400', 1000, 0], ['27111', 70, 0], ['11311', 0, 1070]]);
  });
  it('ต้องมีเหตุผล และห้ามเกินยอดใบแจ้งหนี้', async () => {
    const inv = await doc('INV', '2026-10-15', svc(1000));
    expect(await err(doc('CN', '2026-10-16', svc(100), { ref: inv }))).toContain('เหตุผล');
    expect(await err(doc('CN', '2026-10-16', svc(2000), { ref: inv, reason: 'x' }))).toContain('เกิน');
  });
  it('ยกเลิก CN สร้าง SV-R และยกเลิก INV ได้อีกครั้ง', async () => {
    const inv = await doc('INV', '2026-10-15', svc(1000));
    const cn = await doc('CN', '2026-10-16', svc(100), { ref: inv, reason: 'ลดราคา' });
    expect(await err(db.query('select cancel_sales_doc($1)', [inv]))).toContain('ใบลดหนี้');
    await db.query('select cancel_sales_doc($1)', [cn]);
    const r = await db.query<any>(`select voucher_no from journal_vouchers where voucher_no like '%-R'`);
    expect(r.rows.map(x => x.voucher_no)).toEqual([`${await vno((await get(cn)).voucher_id)}-R`]);
    await db.query('select cancel_sales_doc($1)', [inv]);
    expect((await get(inv)).status).toBe('cancelled');
  });
});

describe('SAL-06 ใบเพิ่มหนี้ (AT-05)', () => {
  it('บรรทัด = ยอดที่เพิ่ม Dr 11311 / Cr 41210 + 27111 · INV ยกเลิกไม่ได้จนกว่าจะยกเลิก DN', async () => {
    const inv = await doc('INV', '2026-10-15', svc(10000));
    const dn = await doc('DN', '2026-10-16', svc(500), { ref: inv });
    const d = await get(dn);
    expect([+d.subtotal, +d.vat, +d.total]).toEqual([500, 35, 535]);
    expect(await entries(d.voucher_id)).toEqual([['11311', 535, 0], ['41210', 0, 500], ['27111', 0, 35]]);
    expect((await get(inv)).status).toBe('awaiting_payment');
    expect(await err(db.query('select cancel_sales_doc($1)', [inv]))).toContain('ใบเพิ่มหนี้');
    await db.query('select cancel_sales_doc($1)', [dn]);
    await db.query('select cancel_sales_doc($1)', [inv]);
    expect((await get(inv)).status).toBe('cancelled');
    const net = await db.query<any>(`select coalesce(sum(closing),0) s from trial_balance('2026-10-01','2026-10-31',true)`);
    expect(+net.rows[0].s).toBe(0);
  });
});

describe('SAL-07 ขายสด', () => {
  it('ลูกค้าเริ่มต้น Cash Sale · RV Dr 11319 / Cr รายได้ + VAT', async () => {
    const r = await db.query<{ id: string }>(`select create_sales_doc('CA','2026-10-15'::date,null,$1::jsonb) as id`, [JSON.stringify(svc(1000))]);
    const d = await get(r.rows[0].id);
    const c = await db.query<any>('select business_name from contacts where id=$1', [d.contact_id]);
    expect(c.rows[0].business_name).toBe('Cash Sale');
    expect(await vno(d.voucher_id)).toBe('RV0001');
    expect(await entries(d.voucher_id)).toEqual([['11319', 1070, 0], ['41210', 0, 1000], ['27111', 0, 70]]);
  });
});

describe('ยกเลิก INV', () => {
  it('สร้าง SV-R ทำให้งบทดลองกลับเป็นศูนย์ และยกเลิกซ้ำไม่ได้', async () => {
    const inv = await doc('INV', '2026-10-15', svc(10000));
    await db.query('select cancel_sales_doc($1)', [inv]);
    const tb = await db.query<any>(`select * from trial_balance('2026-10-01','2026-10-31',false)`);
    for (const r of tb.rows) expect(+r.closing).toBe(0);
    expect(await err(db.query('select cancel_sales_doc($1)', [inv]))).toContain('ยกเลิกแล้ว');
  });
});
