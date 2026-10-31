import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';

const dir = new URL('../supabase/migrations/', import.meta.url);
let db: PGlite;
let cust: string;

const ACCOUNTS: [string, string, string][] = [
  ['11112', 'เงินสด', 'asset'], ['11311', 'ลูกหนี้', 'asset'], ['11319', 'ใบเสร็จรอเรียกเก็บ', 'asset'],
  ['17120', 'ภาษีถูกหัก ณ ที่จ่าย', 'asset'], ['27111', 'ภาษีขาย', 'liability'],
  ['41110', 'รายได้ขายสินค้า', 'revenue'], ['41210', 'รายได้บริการ', 'revenue'], ['41400', 'รับคืนและส่วนลด', 'revenue'],
  ['21921', 'เงินมัดจำรับ', 'liability'], ['11922', 'เงินประกัน', 'asset'], ['21398', 'เงินทดรอง', 'liability'],
  ['11921', 'มัดจำจ่าย', 'asset'], ['49910', 'เงินบริจาค', 'revenue'], ['49990', 'รายได้อื่น', 'revenue'],
];
const svc = (price: number) => [{ description: 'บริการ', kind: 'service', qty: 1, unit_price: price }];
const err = async (p: Promise<unknown>) => { try { await p; return ''; } catch (e) { return (e as Error).message; } };
const one = async <T = any>(q: string, a: unknown[] = []) => (await db.query<any>(q, a)).rows[0] as T;

async function doc(type: string, date: string, lines: object[], extra: Record<string, unknown> = {}) {
  return (await one<{ id: string }>(
    `select create_sales_doc($1,$2::date,$3,$4::jsonb,$5,7,$6,$7) as id`,
    [type, date, extra.contact ?? cust, JSON.stringify(lines), extra.mode ?? 'exclusive', extra.ref ?? null, extra.reason ?? null])).id;
}
const sd = (id: string) => one('select * from sales_docs where id=$1', [id]);
const rc = (id: string) => one('select * from receipts where id=$1', [id]);
async function entries(v: string) {
  const r = await db.query<any>(`select a.code, l.debit, l.credit from journal_lines l join accounts a on a.id=l.account_id
    where voucher_id=$1 order by line_no`, [v]);
  return r.rows.map(x => [x.code, +x.debit, +x.credit]);
}
const reversals = async () =>
  (await db.query<any>(`select voucher_no from journal_vouchers where voucher_no like '%-R' order by voucher_no`)).rows.map(x => x.voucher_no);
const call = (sql: string, a: unknown[] = []) => db.query(sql, a);
const D = '2026-10-15';
const RE = (inv: string, amt: number | null = null) =>
  one<{ id: string }>('select create_receipt_from_invoice($1,$2::date,$3) as id', [inv, D, amt]).then(x => x.id);

beforeAll(async () => {
  db = new PGlite();
  for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(new URL(f, dir), 'utf8'));
});
beforeEach(async () => {
  await db.exec(`truncate receipt_items, receipts, billing_note_items, sales_doc_lines, sales_docs, contacts, journal_lines,
                 journal_vouchers, period_locks, doc_sequences, accounts cascade`);
  for (const [c, n, t] of ACCOUNTS) await db.query('insert into accounts(code,name,type) values ($1,$2,$3)', [c, n, t]);
  cust = (await one<{ id: string }>(`insert into contacts(business_name) values ('ลูกค้าทดสอบ') returning id`)).id;
});

describe('RCV-01/07 ใบเสร็จจาก INV และ WHT (AT-02)', () => {
  it('บันทึก RE → เก็บเงินที่ถูกหัก 3%', async () => {
    const inv = await doc('INV', D, svc(10000));
    await call('select set_invoice_wht($1,3)', [inv]);
    const re = await RE(inv);
    let r = await rc(re);
    expect([r.status, +r.amount, +r.wht]).toEqual(['pending', 10700, 300]);
    expect(await entries(r.save_voucher_id)).toEqual([['11319', 10700, 0], ['11311', 0, 10700]]);
    expect((await sd(inv)).status).toBe('receipt_opened');
    await call('select collect_receipt($1,$2::date)', [re, D]);
    r = await rc(re);
    expect(await entries(r.collect_voucher_id)).toEqual([['11112', 10400, 0], ['17120', 300, 0], ['11319', 0, 10700]]);
  });
  it('แก้อัตรา WHT ไม่ได้เมื่อมีใบเสร็จแล้ว', async () => {
    const inv = await doc('INV', D, svc(10000));
    await RE(inv);
    expect(await err(call('select set_invoice_wht($1,3)', [inv]))).toContain('มีใบเสร็จแล้ว');
  });
  it('ไม่มี WHT ก็เก็บเงินเต็ม Dr 11112 / Cr 11319', async () => {
    const inv = await doc('INV', D, svc(1000));
    const re = await RE(inv);
    await call('select collect_receipt($1,$2::date)', [re, D]);
    expect(await entries((await rc(re)).collect_voucher_id)).toEqual([['11112', 1070, 0], ['11319', 0, 1070]]);
    expect(await err(call('select collect_receipt($1,$2::date)', [re, D]))).toContain('รอเก็บเงิน');
  });
});

describe('RCV-02/03 รีเซ็ตและยกเลิก (AT-06 ตาม D-04)', () => {
  it('รีเซ็ตกลับเป็นรอเก็บ: RV เก็บเงินได้ -R, INV ไม่เปลี่ยน', async () => {
    const inv = await doc('INV', D, svc(1000));
    const re = await RE(inv);
    await call('select collect_receipt($1,$2::date)', [re, D]);
    await call('select reset_receipt($1)', [re]);
    expect((await rc(re)).status).toBe('pending');
    expect((await sd(inv)).status).toBe('receipt_opened');
    expect(await reversals()).toHaveLength(1);
    await call('select collect_receipt($1,$2::date)', [re, D]);   // เก็บซ้ำได้
    expect((await rc(re)).status).toBe('collected');
  });
  it('ยกเลิก RE ที่เก็บเงินแล้ว: -R ทั้งสองใบ และ INV ย้อนกลับเป็นรอเก็บเงิน', async () => {
    const inv = await doc('INV', D, svc(1000));
    const re = await RE(inv);
    await call('select collect_receipt($1,$2::date)', [re, D]);
    await call('select cancel_receipt($1)', [re]);
    expect((await rc(re)).status).toBe('cancelled');
    expect(await reversals()).toHaveLength(2);
    expect((await sd(inv)).status).toBe('awaiting_payment');
    const tb = await one<any>(`select coalesce(sum(abs(closing)),0) s from trial_balance('2026-10-01','2026-10-31',false)
                               where code in ('11112','11319')`);
    expect(+tb.s).toBe(0);
  });
});

describe('RCV-04 แบ่งจ่าย', () => {
  it('แบ่ง 2 งวด WHT รวมเท่าที่หักจริง · ยกเลิกทั้งหมดแล้วย้อนกลับ', async () => {
    const inv = await doc('INV', D, svc(10000));
    await call('select set_invoice_wht($1,3)', [inv]);
    const a = await RE(inv, 5000);
    expect((await sd(inv)).status).toBe('split_paid');
    expect(+(await rc(a)).wht).toBe(140.19);
    expect(await err(RE(inv, 6000))).toContain('ไม่เกินยอดคงเหลือ');
    const b = await RE(inv);
    expect([+(await rc(b)).amount, +(await rc(b)).wht]).toEqual([5700, 159.81]);
    expect((await sd(inv)).status).toBe('receipt_opened');
    await call('select cancel_receipt($1)', [a]);
    expect((await sd(inv)).status).toBe('split_paid');
    await call('select cancel_receipt($1)', [b]);
    expect((await sd(inv)).status).toBe('awaiting_payment');
  });
});

describe('RCV-05 ใบเสร็จรวม', () => {
  it('ดึง DN เข้ามาอัตโนมัติ Dr 11319 / Cr 11311 ยอดรวม · ยกเลิกแล้ว INV ย้อนกลับ', async () => {
    const i1 = await doc('INV', D, svc(1000));
    const i2 = await doc('INV', D, svc(2000));
    const dn = await doc('DN', D, svc(500), { ref: i1 });
    const re = (await one<{ id: string }>('select create_combined_receipt($1::date,$2,$3) as id', [D, cust, [i1, i2]])).id;
    const r = await rc(re);
    expect(+r.amount).toBe(1070 + 535 + 2140);
    expect(await entries(r.save_voucher_id)).toEqual([['11319', 3745, 0], ['11311', 0, 3745]]);
    expect((await sd(i1)).status).toBe('receipt_opened');
    expect(await err(call('select cancel_sales_doc($1)', [dn]))).toContain('ใบเสร็จผูกอยู่');
    await call('select cancel_receipt($1)', [re]);
    expect((await sd(i1)).status).toBe('awaiting_payment');
    expect((await sd(i2)).status).toBe('awaiting_payment');
  });
  it('INV ที่มี CN: ใบเสร็จเดี่ยวไม่ได้ ใบเสร็จรวมหักสุทธิ', async () => {
    const inv = await doc('INV', D, svc(1000));
    await doc('CN', D, svc(100), { ref: inv, reason: 'ลดราคา' });
    expect(await err(RE(inv))).toContain('ใบเสร็จรวม');
    const re = (await one<{ id: string }>('select create_combined_receipt($1::date,$2,$3) as id', [D, cust, [inv]])).id;
    expect(+(await rc(re)).amount).toBe(963);
    expect((await sd(inv)).status).toBe('receipt_opened');
  });
  it('INV ที่มีใบเสร็จ: ออกใบลดหนี้และยกเลิก INV ไม่ได้', async () => {
    const inv = await doc('INV', D, svc(1000));
    await RE(inv);
    expect(await err(doc('CN', D, svc(100), { ref: inv, reason: 'x' }))).toContain('ใบเสร็จผูกอยู่');
    expect(await err(call('select cancel_sales_doc($1)', [inv]))).toContain('ใบเสร็จ');
  });
});

describe('RCV-06 ใบเสร็จรับเงินอื่นๆ', () => {
  const cases: [string, string][] = [
    ['guarantee_return', '11922'], ['advance', '21398'], ['customer_deposit', '21921'],
    ['vendor_deposit_return', '11921'], ['donation', '49910'], ['other_income', '49990'],
  ];
  for (const [type, acc] of cases) {
    it(`${type} → Dr 11319 / Cr ${acc}; เก็บเงิน Dr 11112 / Cr 11319`, async () => {
      const id = (await one<{ id: string }>(`select create_other_receipt($1::date,$2,$3,$4::jsonb) as id`,
        [D, cust, type, JSON.stringify([{ description: 'รายการ', amount: 500 }])])).id;
      expect(await entries((await rc(id)).save_voucher_id)).toEqual([['11319', 500, 0], [acc, 0, 500]]);
      await call('select collect_receipt($1,$2::date)', [id, D]);
      expect(await entries((await rc(id)).collect_voucher_id)).toEqual([['11112', 500, 0], ['11319', 0, 500]]);
      await call('select cancel_receipt($1)', [id]);
      expect(await reversals()).toHaveLength(2);
    });
  }
  it('โหมดนักบัญชี: เลือกบัญชีต่อบรรทัดได้', async () => {
    const id = (await one<{ id: string }>(`select create_other_receipt($1::date,$2,'other_income',$3::jsonb) as id`,
      [D, cust, JSON.stringify([{ description: 'a', amount: 100 }, { description: 'b', amount: 50, account: '41210' }])])).id;
    expect(await entries((await rc(id)).save_voucher_id)).toEqual([['11319', 150, 0], ['49990', 0, 100], ['41210', 0, 50]]);
  });
});

describe('SAL-07 ขายสด เก็บเงิน/รีเซ็ต/ยกเลิก', () => {
  it('collect → reset → collect → cancel', async () => {
    const ca = (await one<{ id: string }>(`select create_sales_doc('CA',$1::date,null,$2::jsonb) as id`, [D, JSON.stringify(svc(1000))])).id;
    await call('select collect_cash_sale($1,$2::date)', [ca, D]);
    expect(await entries((await sd(ca)).collect_voucher_id)).toEqual([['11112', 1070, 0], ['11319', 0, 1070]]);
    await call('select reset_cash_sale($1)', [ca]);
    expect((await sd(ca)).status).toBe('pending_collect');
    await call('select collect_cash_sale($1,$2::date)', [ca, D]);
    await call('select cancel_sales_doc($1)', [ca]);
    expect((await sd(ca)).status).toBe('cancelled');
    const tb = await one<any>(`select coalesce(sum(abs(closing)),0) s from trial_balance('2026-10-01','2026-10-31',false)`);
    expect(+tb.s).toBe(0);
  });
  it('M27.11: เก็บเงินเลือกช่องทาง — โอนเข้าบัญชีธนาคารที่เลือก · ไม่ระบุ = 11112 · บัญชีไม่มี = ข้อความไทย', async () => {
    const acc = (await one<any>(`insert into accounts(code,name,type) values ('11121','ธนาคารทดสอบ','asset') returning id`)).id;
    const bk = (await one<any>(`insert into bank_accounts(account_id,bank_name,account_no,account_name) values ($1,'ธ.ทดสอบ','111','บ') returning id`, [acc])).id;
    const ca = (await one<{ id: string }>(`select create_sales_doc('CA',$1::date,null,$2::jsonb) as id`, [D, JSON.stringify(svc(1000))])).id;
    expect(await err(db.query('select collect_cash_sale($1,$2::date,$3::uuid)', [ca, D, '00000000-0000-0000-0000-000000000000']))).toContain('ไม่พบบัญชีธนาคาร');
    await call('select collect_cash_sale($1,$2::date,$3::uuid)', [ca, D, bk]);
    expect(await entries((await sd(ca)).collect_voucher_id)).toEqual([['11121', 1070, 0], ['11319', 0, 1070]]);
    await call('select reset_cash_sale($1)', [ca]); await call('select cancel_sales_doc($1)', [ca]);
  });
});

describe('DEP มัดจำ (AT-04)', () => {
  const qt = async () => {
    const id = await doc('QT', D, svc(1000));
    await call('select approve_quotation($1)', [id]);
    return id;
  };
  it('มัดจำ 500+35 แล้วออก INV สุดท้าย', async () => {
    const q = await qt();
    const dep = await sd((await one<{ id: string }>('select create_deposit_invoice($1,$2::date,500) as id', [q, D])).id);
    expect([+dep.total, dep.is_deposit]).toEqual([535, true]);
    expect(await entries(dep.voucher_id)).toEqual([['11311', 535, 0], ['21921', 0, 500], ['27111', 0, 35]]);
    expect((await sd(q)).status).toBe('deposit_paid');
    expect(await err(call('select create_deposit_invoice($1,$2::date,100)', [q, D]))).toContain('อนุมัติแล้ว');

    const fin = await sd((await one<{ id: string }>('select create_final_invoice($1,$2::date) as id', [q, D])).id);
    expect([+fin.subtotal, +fin.vat, +fin.total]).toEqual([1000, 35, 535]);
    expect(await entries(fin.voucher_id)).toEqual([
      ['11311', 535, 0], ['21921', 500, 0], ['41210', 0, 1000], ['27111', 0, 35]]);
    expect((await sd(q)).status).toBe('converted');
    // DEP-03 (การออกแบบของเรา): ใบเสร็จของ INV สุดท้ายรับ 535 ตามปกติ
    const re = await RE(fin.id);
    expect(+(await rc(re)).amount).toBe(535);
    // ยอดรวมทั้งงานเมื่อเก็บครบ: ลูกหนี้ 11311 = 0 มัดจำ 21921 = 0
    await RE(dep.id);
    const tb = await db.query<any>(`select code, closing from trial_balance('2026-10-01','2026-10-31',false)`);
    const by = Object.fromEntries(tb.rows.map((x: any) => [x.code, +x.closing]));
    expect(by['11311']).toBe(0);
    expect(by['21921'] ?? 0).toBe(0);
    expect(by['27111']).toBe(-70);
    expect(by['41210']).toBe(-1000);
  });
  it('ยกเลิก INV สุดท้ายแล้ว QT กลับเป็นมัดจำแล้ว · ยกเลิกมัดจำแล้วกลับเป็นอนุมัติ (สันนิษฐาน)', async () => {
    const q = await qt();
    const dep = (await one<{ id: string }>('select create_deposit_invoice($1,$2::date,500) as id', [q, D])).id;
    const fin = (await one<{ id: string }>('select create_final_invoice($1,$2::date) as id', [q, D])).id;
    expect(await err(call('select cancel_sales_doc($1)', [dep]))).toContain('ฉบับสุดท้าย');
    await call('select cancel_sales_doc($1)', [fin]);
    expect((await sd(q)).status).toBe('deposit_paid');
    await call('select cancel_sales_doc($1)', [dep]);
    expect((await sd(q)).status).toBe('approved');
  });
  it('มัดจำเกินมูลค่าใบเสนอราคาไม่ได้', async () => {
    const q = await qt();
    expect(await err(call('select create_deposit_invoice($1,$2::date,1001)', [q, D]))).toContain('ไม่เกิน');
  });
});
