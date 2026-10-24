import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';

const dir = new URL('../supabase/migrations/', import.meta.url);
let db: PGlite;
let vendor: string, prod: string;
const ACCOUNTS: [string, string, string][] = [
  ['11112', 'เงินสด', 'asset'], ['11122', 'ธนาคาร', 'asset'], ['11500', 'สินค้าคงเหลือ', 'asset'],
  ['17113', 'ภาษีซื้อยังไม่ถึงกำหนด', 'asset'], ['21311', 'เจ้าหนี้การค้า', 'liability'], ['21399', 'เจ้าหนี้อื่นๆ', 'liability'],
  ['27124', 'ภาษีหัก ณ ที่จ่าย', 'liability'], ['53101', 'ค่าบริการ', 'expense'], ['51100', 'ต้นทุนขาย', 'expense'],
  ['41110', 'รายได้ขาย', 'revenue'], ['11311', 'ลูกหนี้', 'asset'], ['27111', 'ภาษีขาย', 'liability'], ['11319', 'รอเก็บ', 'asset'], ['41210', 'รายได้บริการ', 'revenue'],
];
const D = '2026-10-15';
const err = async (p: Promise<unknown>) => { try { await p; return ''; } catch (e) { return (e as Error).message; } };
const one = async <T = any>(q: string, a: unknown[] = []) => (await db.query<any>(q, a)).rows[0] as T;
const call = (q: string, a: unknown[] = []) => db.query(q, a);
async function entries(v: string) {
  const r = await db.query<any>(`select a.code, l.debit, l.credit from journal_lines l join accounts a on a.id=l.account_id
    where voucher_id=$1 order by line_no`, [v]);
  return r.rows.map(x => [x.code, +x.debit, +x.credit]);
}
const ri = async (qty = 4, price = 600) =>
  (await one<{ id: string }>('select create_goods_receipt($1::date,$2,$3::jsonb) as id',
    [D, vendor, JSON.stringify([{ product_id: prod, qty, unit_price: price }])])).id;
const exp = async (price = 1000, extra: object = {}) =>
  (await one<{ id: string }>('select create_expense($1::date,$2,$3::jsonb) as id',
    [D, vendor, JSON.stringify([{ description: 'ค่าบริการ', account: '53101', qty: 1, unit_price: price, ...extra }])])).id;
const R = (id: string) => one<any>('select * from goods_receipts where id=$1', [id]);
const E = (id: string) => one<any>('select * from expenses where id=$1', [id]);
const onHand = async () => +(await one<any>('select stock_on_hand($1) v', [prod])).v;
const reversals = async () =>
  (await db.query<any>(`select voucher_no from journal_vouchers where voucher_no like '%-R' order by voucher_no`)).rows.map(x => x.voucher_no);
const tb = async (code: string) =>
  +((await one<any>(`select coalesce(sum(closing),0) c from trial_balance('2026-10-01','2026-10-31',false) where code=$1`, [code])).c);

beforeAll(async () => {
  db = new PGlite();
  for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(new URL(f, dir), 'utf8'));
});
beforeEach(async () => {
  await db.exec(`truncate purchase_payments, cheque_accounts, petty_funds, credit_cards, bank_accounts, stock_alerts, stock_movements, product_stock,
    goods_receipt_lines, goods_receipts, products, wht_certs, expense_lines, expenses, contacts, journal_lines,
    journal_vouchers, period_locks, doc_sequences, accounts cascade`);
  for (const [c, n, t] of ACCOUNTS) await db.query('insert into accounts(code,name,type) values ($1,$2,$3)', [c, n, t]);
  vendor = (await one<{ id: string }>(`insert into contacts(business_name) values ('ผู้ขาย') returning id`)).id;
  prod = (await one<{ id: string }>(`insert into products(code,name,kind,purchase_price) values ('TST-A','A','goods_stock',600) returning id`)).id;
});

describe('M18 ใบรับสินค้า: อนุมัติ / ไม่อนุมัติ / รีเซ็ต', () => {
  it('อนุมัติไม่มีรายการบัญชีเพิ่ม · สต็อกเข้าตั้งแต่บันทึก', async () => {
    const id = await ri();
    expect(await onHand()).toBe(4);
    const n = +(await one<any>('select count(*) c from journal_vouchers')).c;
    await call('select approve_goods_receipt($1)', [id]);
    expect((await R(id)).status).toBe('approved');
    expect(+(await one<any>('select count(*) c from journal_vouchers')).c).toBe(n);
    expect(await err(call('select approve_goods_receipt($1)', [id]))).toContain('รออนุมัติ');
  });
  it('ไม่อนุมัติ: UV ได้ -R, สต็อกถอน, ยอดเจ้าหนี้และสินค้าเป็น 0', async () => {
    const id = await ri();
    await call('select reject_goods_receipt($1)', [id]);
    expect((await R(id)).status).toBe('rejected');
    expect(await reversals()).toEqual(['UV0001-R']);
    expect(await onHand()).toBe(0);
    expect(await tb('21311')).toBe(0);
    expect(await tb('11500')).toBe(0);
  });
  it('รีเซ็ตหลังไม่อนุมัติ: ออก UV ใหม่ + สต็อกคืน กลับเป็นรออนุมัติ · ยอดเท่าเดิม', async () => {
    const id = await ri();
    await call('select reject_goods_receipt($1)', [id]);
    await call('select reset_goods_receipt($1)', [id]);
    const r = await R(id);
    expect(r.status).toBe('unpaid');
    expect(await entries(r.uv_voucher_id)).toEqual([['11500', 2400, 0], ['17113', 168, 0], ['21311', 0, 2568]]);
    expect(await onHand()).toBe(4);
    expect(await tb('21311')).toBe(-2568);
    expect(await reversals()).toEqual(['UV0001-R']);   // ใบ -R เดิมยังอยู่ ไม่ถูกลบ
  });
  it('ไม่อนุมัติไม่ได้ถ้าสต็อกถูกใช้ไปแล้ว', async () => {
    const id = await ri();
    await call(`select create_sales_doc('CA',$1::date,null,$2::jsonb)`,
      [D, JSON.stringify([{ description: 'x', product_id: prod, qty: 3, unit_price: 1000 }])]);
    expect(await err(call('select reject_goods_receipt($1)', [id]))).toContain('ถูกใช้ไปแล้ว');
  });
  it('จ่ายแล้วรีเซ็ต: PV ได้ -R ล้างช่องทางจ่าย กลับรออนุมัติ', async () => {
    const id = await ri();
    await call('select pay_goods_receipt($1,$2::date,$3::jsonb)', [id, D, null]);
    expect((await R(id)).status).toBe('paid');
    await call('select reset_goods_receipt($1)', [id]);
    expect((await R(id)).status).toBe('unpaid');
    expect(+(await one<any>('select count(*) c from purchase_payments')).c).toBe(0);
    expect(await reversals()).toEqual(['PV0001-R']);
    expect(await tb('21311')).toBe(-2568);
  });
  it('ยกเลิกหลังไม่อนุมัติ ไม่กลับรายการซ้ำ', async () => {
    const id = await ri();
    await call('select reject_goods_receipt($1)', [id]);
    await call('select cancel_goods_receipt($1)', [id]);
    expect((await R(id)).status).toBe('cancelled');
    expect(await reversals()).toEqual(['UV0001-R']);
  });
  it('เจ้าหนี้: รออนุมัติและอนุมัติแล้วนับ · ไม่อนุมัติไม่นับ', async () => {
    const a = await ri(), b = await ri();
    await call('select approve_goods_receipt($1)', [b]);
    const n = async () => +(await one<any>(`select count(*) c from ap_aging('2026-10-31')`)).c;
    expect(await n()).toBe(2);
    await call('select reject_goods_receipt($1)', [a]);
    expect(await n()).toBe(1);
  });
});

describe('M18 ค่าใช้จ่าย: ไม่อนุมัติ / รีเซ็ต', () => {
  it('ไม่อนุมัติ → -R · รีเซ็ต → UV ใหม่ยอดเดิม · ยกเลิกได้', async () => {
    const id = await exp(1000);
    await call('select reject_expense($1)', [id]);
    expect((await E(id)).status).toBe('rejected');
    expect(await tb('21399')).toBe(0);
    await call('select reset_expense($1)', [id]);
    const e = await E(id);
    expect(e.status).toBe('pending');
    expect(await entries(e.uv_voucher_id)).toEqual([['53101', 1000, 0], ['17113', 70, 0], ['21399', 0, 1070]]);
    expect(await tb('21399')).toBe(-1070);
  });
  it('ไม่อนุมัติแล้วจ่ายไม่ได้', async () => {
    const id = await exp(1000);
    await call('select reject_expense($1)', [id]);
    expect(await err(call('select pay_expense($1,$2::date)', [id, D]))).toContain('จ่ายเงินได้เฉพาะ');
  });
});

describe('M18 จ่ายหลายช่องทาง', () => {
  const card = async () => (await one<{ id: string }>(
    `select create_credit_card('ธ.กสิกรไทย','1234','TEST','TEST Card',100000,0,3) as id`)).id;
  it('สร้างบัตรเปิดบัญชี 21379.01 อัตโนมัติ', async () => {
    const c = await card();
    const a = await one<any>(`select a.code, a.name, a.type from credit_cards c join accounts a on a.id=c.account_id where c.id=$1`, [c]);
    expect(a).toEqual({ code: '21379.01', name: 'บัตรเครดิต - TEST Card', type: 'liability' });
  });
  it('RI แบ่งจ่าย บัตร 1,568 + เงินสด 1,000 → Dr 21311 2,568 / Cr 21379.01 / Cr 11112', async () => {
    const c = await card();
    const id = await ri();
    const v = (await one<any>('select pay_goods_receipt($1,$2::date,$3::jsonb) v', [id, D,
      JSON.stringify([{ method: 'card', credit_card_id: c, amount: 1568 }, { method: 'cash', amount: 1000 }])])).v;
    expect(await entries(v)).toEqual([['21311', 2568, 0], ['21379.01', 0, 1568], ['11112', 0, 1000]]);
    expect(+(await one<any>('select count(*) c from purchase_payments')).c).toBe(2);
  });
  it('โอนเงินเข้าต้องเลือกบัญชีธนาคาร และลงบัญชีของธนาคารนั้น', async () => {
    const id = await exp(1000);
    expect(await err(call('select pay_expense($1,$2::date,\'11112\',true,\'PND53\',null,$3::jsonb)',
      [id, D, JSON.stringify([{ method: 'transfer', amount: 1070 }])]))).toContain('เลือกบัญชีจ่ายเงิน');
    const acc = (await one<any>(`select id from accounts where code='11122'`)).id;
    const bk = (await one<any>(`insert into bank_accounts(account_id,bank_name,account_no,account_name) values ($1,'ธ.ทดสอบ','111','บริษัท') returning id`, [acc])).id;
    const v = (await one<any>('select pay_expense($1,$2::date,\'11112\',true,\'PND53\',null,$3::jsonb) v',
      [id, D, JSON.stringify([{ method: 'transfer', bank_account_id: bk, amount: 1070 }])])).v;
    expect(await entries(v)).toEqual([['21399', 1070, 0], ['11122', 0, 1070]]);
  });
  it('ผลรวมช่องทางไม่เท่ายอดสุทธิ → ปฏิเสธ (หัก ณ ที่จ่ายหักก่อน)', async () => {
    const id = await exp(1000, { wht_rate: 3 });   // 1070 − 30 = 1040
    const bad = await err(call('select pay_expense($1,$2::date,\'11112\',true,\'PND53\',null,$3::jsonb)',
      [id, D, JSON.stringify([{ method: 'cash', amount: 1070 }])]));
    expect(bad).toContain('ไม่เท่ายอดจ่ายสุทธิ');
    const v = (await one<any>('select pay_expense($1,$2::date,\'11112\',true,\'PND53\',null,$3::jsonb) v',
      [id, D, JSON.stringify([{ method: 'cash', amount: 1040 }])])).v;
    expect(await entries(v)).toEqual([['21399', 1070, 0], ['27124', 0, 30], ['11112', 0, 1040]]);
  });
  it('ช่องทางอื่นๆ ที่ยังไม่ทดสอบ ยังปฏิเสธ', async () => {
    const id = await exp(1000);
    expect(await err(call('select pay_expense($1,$2::date,\'11112\',true,\'PND53\',null,$3::jsonb)',
      [id, D, JSON.stringify([{ method: 'other', amount: 1070 }])]))).toContain('ยังไม่รองรับ');
  });
  it('ไม่ระบุช่องทาง = เงินสดเต็มจำนวน (เหมือนเดิม)', async () => {
    const id = await exp(1000);
    const v = (await one<any>('select pay_expense($1,$2::date) v', [id, D])).v;
    expect(await entries(v)).toEqual([['21399', 1070, 0], ['11112', 0, 1070]]);
  });
});

describe('M18.2 เช็คและเงินสดย่อย', () => {
  const payEx = (id: string, pays: object[]) =>
    one<any>('select pay_expense($1,$2::date,\'11112\',true,\'PND53\',null,$3::jsonb) v', [id, D, JSON.stringify(pays)]);
  const bank = async () => {
    const acc = (await one<any>(`select id from accounts where code='11122'`)).id;
    return (await one<any>(`insert into bank_accounts(account_id,bank_name,account_no,account_name) values ($1,'ธ.ทดสอบ','111','บริษัท') returning id`, [acc])).id;
  };
  it('เงินสดย่อย: เปิดบัญชี 11149.01 และ Cr บัญชีนั้น', async () => {
    const f = (await one<any>(`select create_petty_fund('TEST Petty',5000,'วิศรุต') id`)).id;
    const id = await exp(1000);
    const { v } = await payEx(id, [{ method: 'petty', petty_fund_id: f, amount: 1070 }]);
    expect(await entries(v)).toEqual([['21399', 1070, 0], ['11149.01', 0, 1070]]);
    expect(await err(payEx(await exp(100), [{ method: 'petty', amount: 107 }]))).toContain('วงเงินสดย่อย');
  });
  it('เช็ค: PV วันจ่าย Dr เจ้าหนี้/Cr 21329.01 + PV วันตัดบัญชี Dr 21329.01/Cr ธนาคาร', async () => {
    const bk = await bank();
    const id = await exp(1000);
    const { v } = await payEx(id, [{ method: 'cheque', bank_account_id: bk, cheque_no: '0001', clear_date: '2026-10-31', amount: 1070 }]);
    expect(await entries(v)).toEqual([['21399', 1070, 0], ['21329.01', 0, 1070]]);
    const cv = (await one<any>('select clear_voucher_id c, clear_date::text d from purchase_payments')).c;
    expect(await entries(cv)).toEqual([['21329.01', 1070, 0], ['11122', 0, 1070]]);
    expect(await tb('21329.01')).toBe(0);      // พักแล้วตัดหมดเมื่อถึงวันตัดบัญชี
    expect(await tb('11122')).toBe(-1070);
  });
  it('เช็คต้องมีเลขที่/วันตัดบัญชี/ห้ามค่าธรรมเนียม · ตัดก่อนวันจ่ายไม่ได้', async () => {
    const bk = await bank(); const id = await exp(1000);
    const base = { method: 'cheque', bank_account_id: bk, amount: 1070 };
    expect(await err(payEx(id, [{ ...base, clear_date: '2026-10-31' }]))).toContain('เลขที่เช็ค');
    expect(await err(payEx(id, [{ ...base, cheque_no: '1' }]))).toContain('วันที่ถูกตัดบัญชี');
    expect(await err(payEx(id, [{ ...base, cheque_no: '1', clear_date: '2026-10-01' }]))).toContain('ไม่ก่อนวันที่จ่าย');
    expect(await err(payEx(id, [{ ...base, cheque_no: '1', clear_date: '2026-10-31', fee: 30 }]))).toContain('ค่าธรรมเนียมเช็ค');
    expect(await err(payEx(id, [{ method: 'cheque', cheque_no: '1', clear_date: '2026-10-31', amount: 1070 }]))).toContain('บัญชีเช็คจ่าย');
  });
  it('รีเซ็ตเอกสารที่จ่ายด้วยเช็ค: PV และใบตัดเช็คได้ -R ทั้งคู่ ยอดกลับเป็นเจ้าหนี้', async () => {
    const bk = await bank(); const id = await exp(1000);
    await payEx(id, [{ method: 'cheque', bank_account_id: bk, cheque_no: '0001', clear_date: '2026-10-31', amount: 1070 }]);
    await call('select reset_expense($1)', [id]);
    expect((await reversals()).length).toBe(2);
    expect(await tb('11122')).toBe(0);
    expect(await tb('21399')).toBe(-1070);
    expect(+(await one<any>('select count(*) c from purchase_payments')).c).toBe(0);
  });
});
