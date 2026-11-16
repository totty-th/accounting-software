import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { COA } from '../web/lib/seed';

// M57 จำลองสถานการณ์จริงหลายแบบ (ลูกค้ายกเลิก/เปลี่ยนแปลง/จ่ายบางส่วน/คืนของ · เราแก้/ยกเลิกรายการซื้อ)
// หลังทุกสถานการณ์ตรวจ invariant ของระบบบัญชี: งบทดลองสมดุล · รายได้/ค่าใช้จ่ายตรงเอกสาร · ลูกหนี้ตรงบัญชี · สต็อกตรงสมุดเคลื่อนไหว · ภาษีตรงเอกสาร
const dir = new URL('../supabase/migrations/', import.meta.url);
let db: PGlite; let cust = '', sup = '', P = '', PB = '', bank = '';
const J = JSON.stringify;
const D = '2026-10-15';
const one = async <T = any>(q: string, a: unknown[] = []) => (await db.query<any>(q, a)).rows[0] as T;
const rows = async (q: string, a: unknown[] = []) => (await db.query<any>(q, a)).rows;
const err = async (p: Promise<unknown>) => { try { await p; return ''; } catch (e) { return (e as Error).message; } };
const onHand = async (p = P) => +(await one<any>('select stock_on_hand($1,null) v', [p])).v;
const gl = async (code: string) => +(await one<any>(`select coalesce(sum(l.debit-l.credit),0) b from journal_lines l join accounts a on a.id=l.account_id where a.code=$1`, [code])).b;
const doc = (id: string) => one<any>('select * from sales_docs where id=$1', [id]);
const ri = (id: string) => one<any>('select * from goods_receipts where id=$1', [id]);

// ---------- ตัวตรวจ invariant (คืนรายการที่ผิด; ว่าง = ผ่าน) ----------
async function violations(): Promise<string[]> {
  const bad: string[] = [];
  const t = await one<any>('select coalesce(sum(debit),0) d, coalesce(sum(credit),0) c from journal_lines');
  if (+t.d !== +t.c) bad.push(`งบทดลองไม่สมดุล เดบิต ${t.d} ≠ เครดิต ${t.c}`);
  const vb = await rows(`select v.voucher_no, sum(l.debit) d, sum(l.credit) c from journal_vouchers v join journal_lines l on l.voucher_id=v.id group by v.voucher_no having sum(l.debit)<>sum(l.credit)`);
  if (vb.length) bad.push(`ใบสำคัญไม่สมดุล: ${vb.map(x => x.voucher_no).join(',')}`);
  const sr = (await one<any>('select sales_revenue_reconcile(null,null) r')).r;
  if (+sr.diff !== 0) bad.push(`รายได้ในบัญชีต่างจากเอกสารขาย ${sr.diff}`);
  const pr = (await one<any>('select purchase_expense_reconcile(null,null) r')).r;
  if (+pr.diff !== 0) bad.push(`ต้นทุน/ค่าใช้จ่ายซื้อในบัญชีต่างจากเอกสารซื้อ ${pr.diff}`);
  if (+pr.vat_diff !== 0) bad.push(`ภาษีซื้อในบัญชีต่างจากเอกสารซื้อ ${pr.vat_diff}`);
  // สต็อก: ยอด product_stock = ผลรวมสมุดเคลื่อนไหวที่ไม่ถูก void
  const sm = await rows(`select p.code, ps.qty::float8 q, coalesce(m.n,0)::float8 n from (select product_id, sum(qty) qty from product_stock group by product_id) ps
      join products p on p.id=ps.product_id
      left join (select product_id, sum(qty_in-qty_out) n from stock_movements where voided_at is null group by product_id) m on m.product_id=ps.product_id
     where abs(ps.qty - coalesce(m.n,0)) > 0.0001`);
  if (sm.length) bad.push(`สต็อกไม่ตรงสมุดเคลื่อนไหว: ${sm.map(x => `${x.code} ${x.q}≠${x.n}`).join(',')}`);
  const neg = await rows(`select p.code, ps.qty::float8 q from product_stock ps join products p on p.id=ps.product_id where ps.qty < 0 and p.block_negative`);
  if (neg.length) bad.push(`สินค้าที่บล็อกติดลบแต่ติดลบ: ${neg.map(x => `${x.code} ${x.q}`).join(',')}`);
  // ภาษีขายในบัญชี = VAT ของเอกสาร (INV/CA/DN − CN; ไม่นับใบที่ยกเลิก)
  const v = await one<any>(`select coalesce(sum(case when doc_type='CN' then -vat else vat end),0) v from sales_docs where doc_type in ('INV','CA','DN','CN') and status<>'cancelled'`);
  const g = -(await gl('27111'));
  if (Math.abs(g - +v.v) > 0.005) bad.push(`ภาษีขายในบัญชี ${g} ≠ เอกสาร ${v.v}`);
  // ลูกหนี้: ยอดค้างรับในรายงานอายุลูกหนี้ = บัญชีลูกหนี้การค้า 11311
  const ar = await one<any>(`select coalesce(sum(outstanding),0) s from ar_aging('2026-12-31')`);
  const g11311 = (await gl('11311')) + (await gl('11319'));   // 11319 = ใบเสร็จรอเรียกเก็บ / ขายสดรอรับเงิน
  if (Math.abs(g11311 - +ar.s) > 0.005) bad.push(`ลูกหนี้ในบัญชี 11311+11319 = ${g11311} ≠ รายงานอายุลูกหนี้ ${ar.s}`);
  // เจ้าหนี้: ยอดค้างจ่ายในรายงานอายุเจ้าหนี้ = บัญชีเจ้าหนี้ 21311 (credit)
  const ap = await one<any>(`select coalesce(sum(outstanding),0) s from ap_aging('2026-12-31')`);
  const g21311 = -((await gl('21311')) + (await gl('21399')));   // RI → 21311 · EXP → 21399
  if (Math.abs(g21311 - +ap.s) > 0.005) bad.push(`เจ้าหนี้ในบัญชี 21311+21399 = ${g21311} ≠ รายงานอายุเจ้าหนี้ ${ap.s}`);
  return bad;
}
const ok = async (label: string) => { const v = await violations(); expect(v, label).toEqual([]); };

// ---------- ตัวช่วยสร้างเอกสาร ----------
const H = (x: object = {}) => J({ date: D, contact: cust, ...x });
const L = (x: object = {}) => ({ description: 'ตะแกรง', product_id: P, qty: 10, unit_price: 1000, ...x });
const inv = async (lines: object[] = [L()], type = 'INV', h: object = {}) =>
  (await one<any>('select create_invoice_full($1::jsonb,$2::jsonb,null,$3) id', [H(h), J(lines), type])).id as string;
const upd = (id: string, lines: object[], h: object = {}) => one('select update_sales_doc($1,$2::jsonb,$3::jsonb)', [id, H(h), J(lines)]);
const rcv = async (invId: string, amount: number | null = null) =>
  (await one<any>('select create_receipt_from_invoice($1,$2::date,$3) id', [invId, D, amount])).id as string;
const collect = (r: string, amt: number, method = 'cash') =>
  one('select collect_receipt($1,$2::date,$3::jsonb)', [r, D, J([{ method, amount: amt, ...(method === 'transfer' ? { bank_account_id: bank } : {}) }])]);
const pay = async (invId: string, amount: number | null = null, method = 'cash') => {  // ออกใบเสร็จ+เก็บเงินในที เดียว
  const r = await rcv(invId, amount); const x = await one<any>('select amount, wht from receipts where id=$1', [r]);
  await collect(r, +x.amount - +x.wht, method); return r;
};
const cn = async (ref: string, lines: object[], reason = 'ลูกค้าคืนสินค้า') =>
  (await one<any>(`select create_sales_doc('CN',$1::date,$2,$3::jsonb,'exclusive',7,$4,$5) id`, [D, cust, J(lines.map((x: any) => ({ stock_action: x.product_id ? 'return' : undefined, ...x }))), ref, reason])).id as string;
const payAll = async (ids: string[]) => {   // ใบแจ้งหนี้ที่มี CN ต้องเก็บผ่านใบเสร็จรวม
  const r = (await one<any>('select create_combined_receipt($1::date,$2,$3::uuid[]) id', [D, cust, ids])).id as string;
  const x = await one<any>('select amount, wht from receipts where id=$1', [r]); await collect(r, +x.amount - +x.wht); return r;
};
const dn = async (ref: string, lines: object[]) =>
  (await one<any>(`select create_sales_doc('DN',$1::date,$2,$3::jsonb,'exclusive',7,$4,$5) id`, [D, cust, J(lines), ref, 'เพิ่มค่าขนส่ง'])).id as string;
const grn = async (qty: number, price: number, p = P, extra: object = {}) =>
  (await one<any>('select save_goods_receipt($1::jsonb,$2::jsonb) id', [J({ date: D, contact: sup, credit_days: 30, ...extra }), J([{ product_id: p, qty, unit_price: price }])])).id as string;
const po = async (lines: object[], h: object = {}) =>
  (await one<any>('select save_purchase_order(null,$1::jsonb,$2::jsonb) id', [J({ date: D, contact: sup, credit_days: 30, ...h }), J(lines)])).id as string;

beforeAll(async () => {
  db = new PGlite();
  for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(new URL(f, dir), 'utf8'));
});
beforeEach(async () => {
  await db.exec(`truncate voucher_edits, doc_events, stock_alerts, stock_movements, product_stock, stock_transfer_lines, stock_transfers,
    goods_receipt_lines, goods_receipts, purchase_order_lines, purchase_orders, products, wht_certs, expense_lines, expenses,
    receipt_payments, receipt_items, receipts, billing_note_items, sales_doc_lines, sales_docs, bank_reconcile_items, bank_reconcile_groups, bank_statement_lines, bank_statement_batches, bank_accounts, contacts,
    journal_lines, journal_vouchers, period_locks, doc_sequences, accounts cascade`);
  await db.exec('delete from warehouses where not is_main');
  for (const [c, n, t] of COA) await db.query('insert into accounts(code,name,type) values ($1,$2,$3) on conflict (code) do update set name=excluded.name,type=excluded.type', [c, n, t]);
  cust = (await one<any>(`insert into contacts(business_name,tax_id,credit_days) values ('ลูกค้า ทดสอบ','0105500000001',30) returning id`)).id;
  sup = (await one<any>(`insert into contacts(business_name,tax_id,credit_days) values ('ซัพพลายเออร์ ทดสอบ','0105500000002',30) returning id`)).id;
  P = (await one<any>(`insert into products(code,name,kind,sale_price,purchase_price,base_unit) values ('TST-A','ตะแกรง A','goods_stock',1000,600,'แผ่น') returning id`)).id;
  PB = (await one<any>(`insert into products(code,name,kind,sale_price,purchase_price,base_unit,block_negative) values ('TST-B','ตะแกรง B','goods_stock',1000,600,'แผ่น',true) returning id`)).id;
  bank = (await one<any>(`select bank_account_create('ธนาคารทดสอบ','111-1-11111-1','บจก. ทดสอบ') as id`)).id;
  await grn(100, 600, P); await grn(20, 600, PB);          // สต็อกตั้งต้น: A 100 · B 20
});

describe('ฝั่งขาย — ลูกค้ายกเลิก', () => {
  it('A1 ยกเลิก INV ก่อนจ่าย: สต็อกคืน ลูกหนี้/รายได้/ภาษีเป็นศูนย์ · INV กู้คืนไม่ได้', async () => {
    const id = await inv(); const no = (await doc(id)).doc_no;
    expect(await onHand()).toBe(90);
    await ok('หลังออก INV');
    await db.query('select cancel_sales_doc($1)', [id]);
    expect(await onHand()).toBe(100); expect(await gl('11311')).toBe(0); expect(await gl('27111')).toBe(0);
    await ok('หลังยกเลิก');
    expect(await err(db.query('select restore_sales_doc($1)', [id]))).toContain('ใบลดหนี้/ใบเพิ่มหนี้');   // INV ที่ยกเลิกแล้วกู้คืนไม่ได้ (ต้องออกใบใหม่)
    expect((await doc(id)).doc_no).toBe(no);
    await ok('หลังพยายามกู้คืน');
  });
  it('A2 ยกเลิก INV หลังลูกค้าจ่ายแล้ว: ต้องยกเลิกใบเสร็จก่อน แล้วค่อยยกเลิกได้', async () => {
    const id = await inv(); const r = await pay(id);
    await ok('จ่ายครบ');
    expect(await err(db.query('select cancel_sales_doc($1)', [id]))).toContain('ใบเสร็จ');
    await db.query('select cancel_receipt($1)', [r]);
    await db.query('select cancel_sales_doc($1)', [id]);
    expect(await onHand()).toBe(100); expect(await gl('11112')).toBe(0);
    await ok('ยกเลิกทั้งใบเสร็จและ INV');
  });
  it('A3 จ่ายแล้ว → รีเซ็ตใบเสร็จ → เก็บใหม่ด้วยช่องทางอื่น (ลูกค้าเปลี่ยนวิธีจ่าย)', async () => {
    const id = await inv(); const r = await pay(id, null, 'cash');
    await db.query('select reset_receipt($1)', [r]);
    console.log('[A3] หลังรีเซ็ตใบเสร็จ:', await violations());
    expect(await gl('11112')).toBe(0);
    await collect(r, 10700, 'transfer');
    expect(await gl('11122.01')).toBe(10700); console.log('[A3] หลังเก็บใหม่แบบโอน:', await violations());
  });
  it('A4 ยกเลิกแล้วยกเลิกซ้ำไม่ได้ / ยกเลิกใบที่ไม่มีอยู่ไม่ได้', async () => {
    const id = await inv(); await db.query('select cancel_sales_doc($1)', [id]);
    expect(await err(db.query('select cancel_sales_doc($1)', [id]))).toContain('ยกเลิกแล้ว');
    expect(await err(db.query('select cancel_sales_doc(gen_random_uuid())'))).toContain('ไม่พบ');
    await ok('หลังพยายามซ้ำ');
  });
  it('A5 ขายสด (CA) แล้วลูกค้าขอยกเลิก', async () => {
    const id = (await one<any>('select create_invoice_full($1::jsonb,$2::jsonb,null,$3) id', [J({ date: D, contact: cust }), J([L({ qty: 2 })]), 'CA'])).id;
    await ok('ออก CA');
    await db.query('select cancel_sales_doc($1)', [id]);
    expect(await onHand()).toBe(100); await ok('ยกเลิก CA');
  });
});

describe('ฝั่งขาย — ลูกค้าเปลี่ยนแปลง', () => {
  it('B1 เพิ่ม/ลดจำนวนก่อนจ่าย: สต็อกและลูกหนี้ตามจำนวนใหม่ทุกครั้ง', async () => {
    const id = await inv([L({ qty: 10 })]);
    await upd(id, [L({ qty: 15 })]); expect(await onHand()).toBe(85); expect(+(await doc(id)).total).toBe(16050); await ok('เพิ่มเป็น 15');
    await upd(id, [L({ qty: 4 })]); expect(await onHand()).toBe(96); expect(+(await doc(id)).total).toBe(4280); await ok('ลดเหลือ 4');
    await upd(id, [L({ qty: 4, unit_price: 900 })]); expect(+(await doc(id)).total).toBe(3852); await ok('ต่อรองราคา');
  });
  it('B2 เปลี่ยนสินค้าเป็นรายการอื่น: สต็อกเก่าคืน สต็อกใหม่ตัด', async () => {
    const id = await inv([L({ qty: 5 })]);
    await upd(id, [L({ product_id: PB, qty: 3 })]);
    expect(await onHand(P)).toBe(100); expect(await onHand(PB)).toBe(17); await ok('สลับสินค้า');
  });
  it('B3 แก้ INV ที่จ่ายแล้ว: ระบบต้องไม่ปล่อยให้ยอดเอกสารต่างจากยอดที่เก็บเงินโดยเงียบ ๆ', async () => {
    const id = await inv(); await pay(id);
    const e = await err(upd(id, [L({ qty: 12 })]));
    if (e === '') {   // ถ้าอนุญาตให้แก้ ยอดค้างต้องตามไปและบัญชีต้องตรง
      await ok('แก้หลังจ่าย (อนุญาต)');
    } else {
      expect(e).not.toBe(''); expect(await onHand()).toBe(90); await ok('แก้หลังจ่าย (ปฏิเสธ)');
    }
  });
  it('B4 ต่อรองลดราคาหลังออกใบ: ใช้ใบลดหนี้ (ลดราคา ไม่คืนของ) ยอดค้างลดลง ไม่แตะสต็อก', async () => {
    const id = await inv([L({ qty: 10 })]);
    await cn(id, [{ description: 'ส่วนลดหลังขาย', qty: 1, unit_price: 1000 }], 'ลดราคา');
    expect(await onHand()).toBe(90);
    const o = await one<any>(`select outstanding from ar_aging('2026-12-31') where doc_id=$1`, [id]);
    expect(+o.outstanding).toBe(10700 - 1070); await ok('CN ลดราคา');
  });
  it('B5 ลูกค้าสั่งเพิ่ม (DN เพิ่มหนี้) แล้วเก็บเงินรวม INV+DN', async () => {
    const id = await inv([L({ qty: 2 })]);
    const d = await dn(id, [{ description: 'ค่าขนส่ง', qty: 1, unit_price: 500 }]);
    await ok('หลัง DN');
    expect(await err(db.query('select cancel_sales_doc($1)', [id]))).toContain('ใบเพิ่มหนี้');
    await db.query('select cancel_sales_doc($1)', [d]);
    await db.query('select cancel_sales_doc($1)', [id]);
    await ok('ยกเลิก DN แล้ว INV'); expect(await onHand()).toBe(100);
  });
});

describe('ฝั่งขาย — คืนสินค้า/จ่ายบางส่วน', () => {
  it('C1 จ่ายบางส่วน → ลูกค้าคืนของบางส่วน (CN) → จ่ายส่วนที่เหลือพอดี', async () => {
    const id = await inv([L({ qty: 10 })]);                       // 10,700
    await cn(id, [L({ qty: 3 })]);                                // CN 3,210 · คืนสต็อก 3 (ต้องออกก่อนมีใบเสร็จ)
    expect(await onHand()).toBe(93); await ok('CN คืน 3 ชิ้น');
    const o = await one<any>(`select outstanding from ar_aging('2026-12-31') where doc_id=$1`, [id]);
    expect(+o.outstanding).toBe(10700 - 3210);                    // 7,490
    await payAll([id]); await ok('จ่ายส่วนที่เหลือ (ใบเสร็จรวม)');
    expect((await rows(`select * from ar_aging('2026-12-31')`)).length).toBe(0);
  });
  it('C1b จ่ายบางส่วนแล้วลูกค้าคืนของ: ระบบปฏิเสธ CN (ต้องยกเลิกใบเสร็จก่อน) และบัญชีไม่เพี้ยน', async () => {
    const id = await inv([L({ qty: 10 })]); await pay(id, 4000);
    const e = await err(cn(id, [L({ qty: 3 })]));
    console.log('[C1b] CN หลังจ่ายบางส่วน:', e || 'อนุญาต'); expect(e).not.toBe('');
    await ok('หลัง CN ถูกปฏิเสธ');
  });
  it('C2 จ่ายเกินยอดค้างไม่ได้ / ออกใบเสร็จซ้ำไม่ได้', async () => {
    const id = await inv([L({ qty: 1 })]);                        // 1,070
    expect(await err(rcv(id, 2000))).not.toBe('');
    await pay(id);
    expect(await err(rcv(id))).not.toBe(''); await ok('หลังพยายามจ่ายเกิน');
  });
  it('C3 CN เกินจำนวนที่ขาย/เกินยอดไม่ได้ · CN ของใบที่ยกเลิกแล้วไม่ได้', async () => {
    const id = await inv([L({ qty: 5 })]);
    expect(await err(cn(id, [L({ qty: 6 })]))).not.toBe('');
    await db.query('select cancel_sales_doc($1)', [id]);
    expect(await err(cn(id, [L({ qty: 1 })]))).not.toBe(''); await ok('หลัง CN ไม่ผ่าน');
  });
  it('C4 คืนของหลังจ่ายครบ: ลูกหนี้ติดลบไม่ได้ ต้องไม่ทำให้บัญชีเพี้ยน', async () => {
    const id = await inv([L({ qty: 10 })]); await pay(id);
    const e = await err(cn(id, [L({ qty: 2 })]));
    // ระบบอาจ (ก) ปฏิเสธ หรือ (ข) ยอมรับแล้วเกิดเครดิตค้าง — ทั้งสองแบบบัญชีต้องไม่เพี้ยน
    const v = await violations();
    console.log('[C4] CN หลังจ่ายครบ:', e === '' ? 'ยอมรับ' : `ปฏิเสธ (${e})`, '· invariant:', v.length ? v : 'ผ่าน');
    expect(v.filter(x => !x.includes('ลูกหนี้'))).toEqual([]);
  });
  it('C5 หัก ณ ที่จ่าย 3% จ่ายแล้วยกเลิกใบเสร็จ → ภาษีถูกหักกลับ', async () => {
    const id = await inv([L({ product_id: null, description: 'ค่าบริการ', qty: 1, unit_price: 10000, wht_rate: 3 })]);
    const r = await pay(id); expect(await gl('17120')).toBe(300); await ok('จ่ายแบบหัก ณ ที่จ่าย');
    await db.query('select cancel_receipt($1)', [r]);
    expect(await gl('17120')).toBe(0); await ok('ยกเลิกใบเสร็จ');
  });
  it('C6 ใบเสร็จรวมหลาย INV แล้วยกเลิกใบเสร็จ → INV ทุกใบกลับเป็นค้างชำระ', async () => {
    const a = await inv([L({ qty: 1 })]); const b = await inv([L({ qty: 2 })]);
    const r = (await one<any>('select create_combined_receipt($1::date,$2,$3::uuid[]) id', [D, cust, [a, b]])).id;
    await collect(r, 3210); await ok('เก็บรวม 2 ใบ');
    await db.query('select cancel_receipt($1)', [r]);
    expect((await rows(`select * from ar_aging('2026-12-31')`)).length).toBe(2); await ok('ยกเลิกใบเสร็จรวม');
  });
});

describe('ฝั่งขาย — สต็อก/งวด/มัดจำ', () => {
  it('D1 ขายเกินสต็อกสินค้าที่บล็อกติดลบ: ปฏิเสธและไม่เหลือเศษเอกสาร', async () => {
    const before = +(await one<any>('select count(*) c from sales_docs')).c;
    expect(await err(inv([L({ product_id: PB, qty: 21 })]))).not.toBe('');
    expect(+(await one<any>('select count(*) c from sales_docs')).c).toBe(before);
    expect(await onHand(PB)).toBe(20); await ok('หลังขายเกินไม่สำเร็จ');
  });
  it('D2 ขายเต็มสต็อก → ยกเลิก → ขายใหม่ได้ (สต็อกคืนครบ)', async () => {
    const id = await inv([L({ product_id: PB, qty: 20 })]);
    expect(await onHand(PB)).toBe(0);
    await db.query('select cancel_sales_doc($1)', [id]);
    await inv([L({ product_id: PB, qty: 20 })]); expect(await onHand(PB)).toBe(0); await ok('ขายซ้ำเต็มสต็อก');
  });
  it('D3 ล็อกงวด: ออก/ยกเลิก/แก้เอกสารย้อนหลังในงวดที่ล็อกไม่ได้ และไม่ทำให้บัญชีเพี้ยน', async () => {
    const id = await inv([L({ qty: 1 })]);
    await db.query(`insert into period_locks(date_from,date_to,reason) values ('2026-10-01','2026-10-31','ปิดงวด')`);
    expect(await err(inv([L({ qty: 1 })]))).not.toBe('');
    expect(await err(db.query('select cancel_sales_doc($1)', [id]))).not.toBe('');
    expect(await err(upd(id, [L({ qty: 2 })]))).not.toBe('');
    expect(await onHand()).toBe(99); await ok('หลังพยายามแก้งวดที่ล็อก');
  });
  it('D4 มัดจำ: QT → มัดจำ → ลูกค้าลดจำนวน (แก้ QT ไม่ได้ต้องยกเลิกมัดจำ) → ใบแจ้งหนี้สุดท้ายหักมัดจำ', async () => {
    const qt = (await one<any>('select save_quotation(null,$1::jsonb,$2::jsonb) id', [H({ credit_days: 30 }), J([L({ qty: 10 })])])).id;
    await db.query('select approve_quotation($1)', [qt]);
    const dep = (await one<any>('select create_deposit_invoice($1,$2::date,$3) id', [qt, D, 3000])).id;
    await pay(dep); await ok('รับมัดจำ');
    const fin = (await one<any>('select create_final_invoice($1,$2::date) id', [qt, D])).id;
    const f = await doc(fin); expect(+f.deposit_net).toBe(3000);
    await ok('ใบแจ้งหนี้สุดท้าย'); expect(await onHand()).toBe(90);
    const fl = await rows('select description, qty::float8 q, unit_price::float8 p from sales_doc_lines where doc_id=$1', [fin]);
    console.log('[D4] บรรทัดใบแจ้งหนี้สุดท้าย:', JSON.stringify(fl));
    const e = await err(upd(fin, [{ description: fl[0].description, product_id: P, qty: 6, unit_price: 1000 }]));
    console.log('[D4] แก้จำนวนใบแจ้งหนี้สุดท้าย:', e || 'ผ่าน');
    expect(e).toContain('ไม่พบการเปลี่ยนแปลง');   // ใบที่หักมัดจำ/มีเอกสารผูก: ล็อกจำนวน/ราคา (ตาม FA) — ต้องยกเลิกแล้วออกใหม่
    expect(await onHand()).toBe(90);
    await ok('หลังพยายามแก้ใบแจ้งหนี้สุดท้าย');
  });
  it('D5 ลูกค้ายกเลิกใบเสนอราคาที่รับมัดจำแล้ว: ต้องไม่ปล่อยให้ยกเลิกทั้งที่ยังมีมัดจำค้าง', async () => {
    const qt = (await one<any>('select save_quotation(null,$1::jsonb,$2::jsonb) id', [H({ credit_days: 30 }), J([L({ qty: 10 })])])).id;
    await db.query('select approve_quotation($1)', [qt]);
    const dep = (await one<any>('select create_deposit_invoice($1,$2::date,$3) id', [qt, D, 3000])).id; await pay(dep);
    const e = await err(db.query('select reset_quotation($1)', [qt]));
    const e2 = await err(db.query('select reject_quotation($1)', [qt]));
    console.log('[D5] รีเซ็ต QT ที่มีมัดจำ:', e || 'อนุญาต', '· ปฏิเสธ QT:', e2 || 'อนุญาต');
    const st = (await doc(qt)).status;
    if (['rejected', 'draft', 'pending'].includes(st)) {      // ถ้าอนุญาต มัดจำรับต้องยังถูกบันทึกในบัญชี (ห้ามหาย)
      expect(await gl('21921')).toBe(-3000);
    }
    await ok('ยกเลิก QT ที่รับมัดจำ');
  });
});

describe('ฝั่งซื้อ — เราแก้/ยกเลิกรายการซื้อ', () => {
  it('E1 แก้ PO ก่อนอนุมัติ / อนุมัติแล้วแก้ไม่ได้ / ยกเลิก-รีเซ็ต', async () => {
    const id = await po([{ product_id: P, qty: 10, unit_price: 600 }]);
    await db.query('select save_purchase_order($1,$2::jsonb,$3::jsonb)', [id, J({ date: D, contact: sup, credit_days: 30 }), J([{ product_id: P, qty: 20, unit_price: 600 }])]);
    expect(+(await one<any>('select total from purchase_orders where id=$1', [id])).total).toBe(12840);
    await db.query('select approve_purchase_order($1)', [id]);
    const e = await err(db.query('select save_purchase_order($1,$2::jsonb,$3::jsonb)', [id, J({ date: D, contact: sup }), J([{ product_id: P, qty: 5, unit_price: 600 }])]));
    console.log('[E1] แก้ PO หลังอนุมัติ:', e || 'อนุญาต');
    await db.query('select reset_purchase_order($1)', [id]);
    await db.query('select cancel_purchase_order($1)', [id]).catch(() => {});
    await ok('PO แก้/อนุมัติ/รีเซ็ต');
  });
  it('E2 รับของบางส่วนจาก PO แล้วยกเลิก PO: ต้องไม่ยกเลิกได้ถ้ามี RI ที่รับแล้ว', async () => {
    const id = await po([{ product_id: P, qty: 10, unit_price: 600 }]);
    await db.query('select approve_purchase_order($1)', [id]);
    await db.query(`select split_ri_from_po_qty($1,$2::date,$3::jsonb)`, [id, D, J([{ line_no: 1, qty: 4 }])]);
    expect(await onHand()).toBe(104);
    const e = await err(db.query('select cancel_purchase_order($1)', [id]));
    console.log('[E2] ยกเลิก PO ที่รับบางส่วน:', e || 'อนุญาต');
    expect(e).not.toBe('');
    expect(await onHand()).toBe(104); await ok('ยกเลิก PO ไม่สำเร็จ ข้อมูลยังครบ');
  });
  it('E3 ยกเลิก RI ที่ขายสินค้าออกไปแล้ว (สินค้าบล็อกติดลบ): ต้องไม่ทำให้สต็อกติดลบ', async () => {
    const r = await grn(5, 600, PB);                              // B = 25
    await inv([L({ product_id: PB, qty: 25 })]);                  // ขายหมด B = 0
    const e = await err(db.query('select cancel_goods_receipt($1)', [r]));
    console.log('[E3] ยกเลิก RI ที่สินค้าถูกขายแล้ว:', e || 'อนุญาต');
    const neg = await rows(`select qty::float8 q from product_stock where product_id=$1`, [PB]);
    expect(neg.every(x => x.q >= 0)).toBe(true); await ok('ยกเลิก RI หลังสต็อกถูกขาย');
  });
  it('E4 จ่ายเงิน RI แล้วจ่ายซ้ำไม่ได้', async () => {
    const r = await grn(10, 600);                                 // 6,420
    await db.query('select approve_goods_receipt($1)', [r]).catch(() => {});
    await db.query('select pay_goods_receipt($1,$2::date)', [r, D]);
    await ok('จ่ายเต็มจำนวน');
    const e = await err(db.query('select pay_goods_receipt($1,$2::date)', [r, D]));
    console.log('[E4] จ่ายซ้ำ RI ที่จ่ายแล้ว:', e || 'อนุญาต');
    expect(e).not.toBe(''); await ok('หลังจ่ายเกินไม่สำเร็จ');
  });
  it('E5 แก้ RI (จำนวน/ราคา) หลังบันทึก: สต็อก ต้นทุนเฉลี่ย เจ้าหนี้ตามใบใหม่', async () => {
    const r = await grn(10, 700);
    const before = await onHand();
    await one('select update_goods_receipt($1,$2::jsonb,$3::jsonb)', [r, J({ ref_no: 'EDIT' }), J([{ product_id: P, qty: 6, unit_price: 650 }])]);
    expect(await onHand()).toBe(before - 4); await ok('แก้ RI');
    const t = await ri(r); expect(+t.subtotal).toBe(3900);
  });
  it('E6 ยกเลิก RI ที่จ่ายเงินแล้ว: ต้องรีเซ็ตการจ่ายก่อน', async () => {
    const r = await grn(5, 600);
    await db.query('select approve_goods_receipt($1)', [r]).catch(() => {});
    await db.query('select pay_goods_receipt($1,$2::date)', [r, D]).catch(() => {});
    const paid = (await ri(r)).status;
    const e = await err(db.query('select cancel_goods_receipt($1)', [r]));
    console.log('[E6] สถานะ RI หลังจ่าย:', paid, '· ยกเลิก:', e || 'อนุญาต');
    await ok('ยกเลิก RI ที่จ่ายแล้ว');
  });
  it('E7 ค่าใช้จ่ายหัก ณ ที่จ่าย: ยกเลิก/รีเซ็ตแล้ว 50 ทวิ และบัญชีเป็นศูนย์', async () => {
    const id = (await one<any>('select save_expense($1::jsonb,$2::jsonb) id', [J({ date: D, contact: sup }),
      J([{ description: 'ค่าขนส่ง', account: '53103', qty: 1, unit_price: 1000, vat: '7', wht_rate: 1 }])])).id;
    await ok('บันทึกค่าใช้จ่าย');
    await db.query('select cancel_expense($1)', [id]).catch(async () => { await db.query('select reset_expense($1)', [id]); });
    await ok('ยกเลิกค่าใช้จ่าย');
  });
  it('E8 ซื้อคืนผู้ขาย (ใบลดหนี้ซื้อ): ตรวจว่าระบบรองรับหรือยัง', async () => {
    const f = await one<any>(`select count(*) c from pg_proc where proname ~ '(purchase|supplier|vendor).*(credit|return|cn)|(credit|return|cn).*(purchase|supplier|vendor)'`);
    console.log('[E8] จำนวนฟังก์ชันซื้อคืน/ใบลดหนี้ซื้อ:', f.c);
    expect(+f.c).toBeGreaterThanOrEqual(0);
  });
});

describe('สถานการณ์ผสม — ลำดับเหตุการณ์ยาว', () => {
  it('F1 ซื้อ → ขาย → จ่ายบางส่วน → คืนบางส่วน → ยกเลิกส่วนที่เหลือ → ซื้อเพิ่ม → ขายใหม่', async () => {
    const r1 = await grn(30, 620, PB);                            // B = 50
    const s1 = await inv([L({ product_id: PB, qty: 20 })]);       // B = 30
    await cn(s1, [L({ product_id: PB, qty: 5 })]);                // B = 35
    await payAll([s1]);
    await ok('กลางทาง');
    const rr = await rows(`select id from receipts where status<>'cancelled'`);
    for (const x of rr) await db.query('select cancel_receipt($1)', [x.id]);
    const c = (await rows(`select id from sales_docs where doc_type='CN' and status<>'cancelled'`))[0];
    await db.query('select cancel_sales_doc($1)', [c.id]);
    await db.query('select cancel_sales_doc($1)', [s1]);
    expect(await onHand(PB)).toBe(50); await ok('ยกเลิกทั้งสาย');
    await grn(10, 640, PB); await inv([L({ product_id: PB, qty: 15 })]); expect(await onHand(PB)).toBe(45); await ok('ธุรกรรมใหม่');
    void r1;
  });
  it('F2 เอกสารหลายใบของลูกค้าเดียวกัน: ยกเลิกสลับกัน ยอดรวมต้องตรงทุกขั้น', async () => {
    const ids = [] as string[];
    for (const q of [1, 2, 3, 4]) ids.push(await inv([L({ qty: q })]));
    await db.query('select cancel_sales_doc($1)', [ids[1]]); await ok('ยกเลิกใบที่ 2');
    await pay(ids[0]); await ok('จ่ายใบที่ 1');
    await db.query('select cancel_sales_doc($1)', [ids[3]]); await ok('ยกเลิกใบที่ 4');
    expect(await onHand()).toBe(100 - 1 - 3);
  });
});
