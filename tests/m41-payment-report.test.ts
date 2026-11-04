import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { channelOptions, paymentRows, groupPayments, paymentExportRows } from '../web/lib/payment-report';

// จำลองเอกสารจริงตาม flow ซื้อ/ค่าใช้จ่าย แล้วตรวจรายงานการชำระเงิน (ช่องทาง / ยอดเอกสารสุทธิ / ยอดชำระ / เอกสารยกเลิก)
const dir = new URL('../supabase/migrations/', import.meta.url);
let db: PGlite; const D = '2026-10-15';
const ACCOUNTS: [string, string, string][] = [
  ['11112', 'เงินสด', 'asset'], ['11122', 'ธนาคาร', 'asset'], ['11500', 'สินค้าคงเหลือ', 'asset'], ['17113', 'ภาษีซื้อยังไม่ถึงกำหนด', 'asset'], ['17111', 'ภาษีซื้อ', 'asset'],
  ['21311', 'เจ้าหนี้การค้า', 'liability'], ['21399', 'เจ้าหนี้อื่นๆ', 'liability'], ['27124', 'ภาษีหัก ณ ที่จ่าย', 'liability'], ['53101', 'ค่าบริการ', 'expense'], ['11113', 'เงินสดย่อย', 'asset'],
];
const one = async <T = any>(q: string, a: unknown[] = []) => (await db.query<any>(q, a)).rows[0] as T;
const dbq = { q: async <T = any>(sql: string, p: unknown[] = []) => (await db.query<any>(sql, p)).rows as T[] };
const num = (x: unknown) => Math.round(Number(x) * 100) / 100;
let v1: string, v2: string, prod: string, bank: string, petty: string;
const exp = async (v: string, price: number, extra: object = {}) => (await one<any>('select create_expense($1::date,$2,$3::jsonb) id', [D, v, JSON.stringify([{ description: 'x', account: '53101', qty: 1, unit_price: price, ...extra }])])).id;
const ri = async (v: string, qty: number, price: number) => (await one<any>('select create_goods_receipt($1::date,$2,$3::jsonb) id', [D, v, JSON.stringify([{ product_id: prod, qty, unit_price: price }])])).id;
const payE = (id: string, p: object[] | null = null) => db.query('select pay_expense($1,$2::date,$3,$4,$5,$6,$7::jsonb)', [id, D, '11112', false, 'PND53', null, p ? JSON.stringify(p) : null]);

beforeAll(async () => {
  db = new PGlite(); for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(new URL(f, dir), 'utf8'));
  await db.exec('truncate accounts cascade');
  for (const [c, n, t] of ACCOUNTS) await db.query('insert into accounts(code,name,type) values ($1,$2,$3)', [c, n, t]);
  v1 = (await one<any>(`insert into contacts(business_name) values ('ผู้ขาย A') returning id`)).id;
  v2 = (await one<any>(`insert into contacts(business_name) values ('ผู้ขาย B') returning id`)).id;
  prod = (await one<any>(`insert into products(code,name,kind,purchase_price) values ('TST-A','A','goods_stock',600) returning id`)).id;
  const acc = (await one<any>(`select id from accounts where code='11122'`)).id, pa = (await one<any>(`select id from accounts where code='11113'`)).id;
  bank = (await one<any>(`insert into bank_accounts(account_id,bank_name,account_no,account_name) values ($1,'กสิกร','111-1','บ') returning id`, [acc])).id;
  petty = (await one<any>(`insert into petty_funds(account_id,fund_name,custodian) values ($1,'เงินสดย่อยสำนักงาน','สมชาย') returning id`, [pa]).catch?.(() => null) ?? null)?.id;
});

describe('รายงานการชำระเงิน: จำลองเอกสารจริงตาม flow', () => {
  it('ยอดต่อช่องทาง/ยอดเอกสารสุทธิ ตรงกับเอกสารจริงทุกกรณี', async () => {
    // 1) ค่าใช้จ่ายมี หัก ณ ที่จ่าย 3% จ่ายเงินสดเต็ม
    const a = await exp(v1, 1000, { wht_rate: 3 }); await payE(a);
    // 2) ค่าใช้จ่ายแบ่งจ่ายเงินสด + โอน
    const b = await exp(v1, 2000); const bt = num((await one<any>('select total from expenses where id=$1', [b])).total);
    await payE(b, [{ method: 'cash', amount: 500 }, { method: 'transfer', bank_account_id: bank, amount: num(bt - 500) }]);
    // 3) ค่าใช้จ่ายจ่ายเช็ค
    const c = await exp(v2, 3000); const ct = num((await one<any>('select total from expenses where id=$1', [c])).total);
    await payE(c, [{ method: 'cheque', bank_account_id: bank, cheque_no: 'CQ001', clear_date: '2026-10-31', amount: ct }]);
    // 4) ใบรับสินค้าจ่ายเงินสดเต็ม
    const r1 = await ri(v1, 4, 600); const r1t = num((await one<any>('select total from goods_receipts where id=$1', [r1])).total);
    await db.query('select pay_goods_receipt($1,$2::date,$3::jsonb)', [r1, D, JSON.stringify([{ method: 'cash', amount: r1t }])]);
    // 5) ใบรับสินค้าผ่านใบเตรียมจ่าย + หัก ณ ที่จ่าย (ยอดจ่าย = ยอดเต็ม − หัก)
    const r2 = await ri(v2, 2, 500); const r2t = num((await one<any>('select total from goods_receipts where id=$1', [r2])).total);
    const s = (await one<any>('select create_payment_slip($1::date,$1::date,$2::jsonb) id', [D, JSON.stringify([{ type: 'RI', id: r2 }])])).id;
    await db.query(`select pay_payment_slip_vendor($1,$2,$3::date,null,30,false,'PND53')`, [s, v2, D]);
    // 6) ค่าใช้จ่ายที่จ่ายแล้วถูกยกเลิก → ต้องไม่อยู่ในรายงาน
    const x = await exp(v1, 700); await payE(x); await db.query('select cancel_expense($1)', [x]);

    const rows = await paymentRows(dbq, [D, D], []);
    const g = groupPayments(rows);
    const label = (k: string) => g.groups.find(x => x.key.startsWith(k));
    // ไม่มีเอกสารยกเลิก
    expect(rows.some(r => r.doc_id === x)).toBe(false);
    // ยอดเอกสารสุทธิ: EXP = total − wht · RI = total − wht_paid
    const netA = num((await one<any>('select total - wht_total n from expenses where id=$1', [a])).n);
    const docNet = (id: string) => num(rows.find(r => r.doc_id === id)?.net);
    expect(docNet(a)).toBe(netA); expect(netA).toBeLessThan(1070);
    expect(docNet(r2)).toBe(num(r2t - 30));
    // แบ่งจ่าย 2 ช่องทาง: ยอดชำระรวมต่อเอกสาร = ยอดเอกสาร
    const paidOf = (id: string) => num(rows.filter(r => r.doc_id === id).reduce((t, r) => t + Number(r.amount), 0));
    for (const id of [a, b, c, r1, r2]) expect(paidOf(id)).toBe(docNet(id));
    // กลุ่มตามช่องทาง: เงินสด = a + 500 + r1 · โอน = b − 500 · เช็ค = c · โอน (ใบเตรียมจ่าย) ไม่มี (จ่ายเงินสด)
    expect(label('cash')!.paid).toBe(num(netA + 500 + r1t + (docNet(r2))));
    expect(label('transfer:')!.paid).toBe(num(bt - 500));
    expect(label('cheque:')!.paid).toBe(ct);
    // ยอดเอกสารของกลุ่มที่มีเอกสารเดียวต้องไม่เกินยอดจริง (นับเอกสารเดียวครั้งเดียวต่อกลุ่ม)
    expect(label('cheque:')!.net).toBe(ct);
    expect(label('transfer:')!.net).toBe(docNet(b));
    // ยอดรวมทั้งหมด: ยอดเอกสาร (นับเอกสารละ 1 ครั้ง) = ยอดชำระ เมื่อจ่ายครบทุกใบ
    expect(g.docCount).toBe(5); expect(g.totNet).toBe(g.totPaid);
    // ไฟล์ Excel: คิวรีทำงานกับใบรับสินค้า (wht_paid) · ยอดเต็ม − หัก − จ่ายแล้ว = ผลต่าง 0 ทุกใบ · เลขใบเตรียมจ่ายของ RI
    const ex = await paymentExportRows(dbq, [D, D], []);
    expect(ex.length).toBe(rows.length);
    for (const r of ex) expect(num(Number(r.net) - Number(r.wht) - Number(r.doc_paid))).toBe(0);
    expect(ex.find(r => r.doc_id === r2)!.slip).toBeTruthy(); expect(ex.find(r => r.doc_id === r2)!.wht).toBe('30.00');
    // ตัวเลือกช่องทาง
    expect((await channelOptions(dbq)).length).toBe(g.groups.length);
    // กรองช่องทางเดียว
    const only = await paymentRows(dbq, null, [label('cheque:')!.key]);
    expect(only.every(r => r.method === 'cheque')).toBe(true);
  });
});
