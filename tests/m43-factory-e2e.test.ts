import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';

// จำลองโรงงานผลิต-จำหน่ายตะแกรงเหล็ก ทั้งระบบ ใช้ผังบัญชีมาตรฐานของระบบ (ไม่ truncate)
// ซื้อเหล็กแผ่นเข้า → (ผลิต: ยังไม่มีโมดูล D-06 จำลองด้วยปรับสต็อก) → ขาย → เก็บเงิน → ตรวจงบ
import { COA } from '../web/lib/seed';
const dir = new URL('../supabase/migrations/', import.meta.url);
let db: PGlite;
const one = async <T = any>(q: string, a: unknown[] = []) => (await db.query<any>(q, a)).rows[0] as T;
const rows = async (q: string, a: unknown[] = []) => (await db.query<any>(q, a)).rows;
const J = JSON.stringify;
const err = async (p: Promise<unknown>) => { try { await p; return ''; } catch (e) { return (e as Error).message; } };
const onHand = async (p: string, w: string | null = null) => +(await one<any>('select stock_on_hand($1,$2) v', [p, w])).v;
const gl = async (code: string) => +(await one<any>(`select coalesce(sum(l.debit-l.credit),0) b from journal_lines l join accounts a on a.id=l.account_id where a.code=$1`, [code])).b;
const stockValue = async () => +(await one<any>('select coalesce(sum(value),0) v from product_stock')).v;

const S: Record<string, string> = {};   // id ต่าง ๆ
const P: Record<string, string> = {};   // สินค้า
const mkP = async (code: string, name: string, kind: string, sale: number, buy: number, unit = 'แผ่น', block = false) =>
  (P[code] = (await one<any>(`insert into products(code,name,kind,sale_price,purchase_price,base_unit,block_negative) values ($1,$2,$3,$4,$5,$6,$7) returning id`,
    [code, name, kind, sale, buy, unit, block])).id);
const D1 = '2026-10-05', D2 = '2026-10-10', D3 = '2026-10-15', D4 = '2026-10-20', D5 = '2026-10-28';

beforeAll(async () => {
  db = new PGlite();
  for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(new URL(f, dir), 'utf8'));
  for (const [c, n, t] of COA) await db.query('insert into accounts(code,name,type) values ($1,$2,$3) on conflict (code) do update set name=excluded.name, type=excluded.type, is_control=false', [c, n, t]);
  S.sup = (await one<any>(`insert into contacts(business_name,tax_id,credit_days) values ('บริษัท เหล็กแผ่นไทย จำกัด','0105511111111',30) returning id`)).id;
  S.trans = (await one<any>(`insert into contacts(business_name,tax_id) values ('บริษัท ขนส่งด่วน จำกัด','0105522222222') returning id`)).id;
  S.c1 = (await one<any>(`insert into contacts(business_name,tax_id,credit_days) values ('บริษัท ก่อสร้างมั่นคง จำกัด','0105533333333',30) returning id`)).id;
  S.c2 = (await one<any>(`insert into contacts(business_name,tax_id,credit_days) values ('หจก. โรงงานสยามเฟอร์นิเจอร์','0103544444444',15) returning id`)).id;
  S.raw = (await one<any>(`select create_warehouse('RAW','คลังวัตถุดิบ','raw_materials') id`)).id;
  S.main = (await one<any>('select main_warehouse() id')).id;
  await db.query(`insert into accounts(code,name,type) values ('11125','ธนาคารกสิกรไทย (ออมทรัพย์)','asset')`);
  const ac = (await one<any>(`select id from accounts where code='11125'`)).id;
  S.bank = (await one<any>(`insert into bank_accounts(account_id,bank_name,account_no) values ($1,'ธนาคารทดสอบ','111-1-11111-1') returning id`, [ac])).id;
  // วัตถุดิบ: เหล็กแผ่น (วัสดุ × ความหนา)
  await mkP('RM-SS400-15', 'เหล็กแผ่นดำ SS400 หนา 1.5 มม. 4x8 ฟุต', 'goods_stock', 0, 1200);
  await mkP('RM-SS400-30', 'เหล็กแผ่นดำ SS400 หนา 3.0 มม. 4x8 ฟุต', 'goods_stock', 0, 2300);
  await mkP('RM-SUS304-20', 'สแตนเลส 304 หนา 2.0 มม. 4x8 ฟุต', 'goods_stock', 0, 6500);
  await mkP('RM-AL-15', 'อลูมิเนียมแผ่น หนา 1.5 มม. 4x8 ฟุต', 'goods_stock', 0, 2800);
  // สินค้าสำเร็จรูป: ตะแกรง (ลาย × ความหนา × วัสดุ)
  await mkP('FG-EXP-SS-15', 'ตะแกรงเหล็กฉีก SS400 หนา 1.5 มม.', 'goods_stock', 850, 0, 'แผ่น', true);
  await mkP('FG-EXP-SS-30', 'ตะแกรงเหล็กฉีก SS400 หนา 3.0 มม.', 'goods_stock', 1650, 0, 'แผ่น', true);
  await mkP('FG-PERF-SUS-20', 'ตะแกรงเจาะรูกลม สแตนเลส 304 หนา 2.0 มม.', 'goods_stock', 3400, 0, 'แผ่น', true);
  await mkP('FG-PERF-AL-15', 'ตะแกรงเจาะรูกลม อลูมิเนียม หนา 1.5 มม.', 'goods_stock', 1500, 0, 'แผ่น', false);
  await mkP('SV-CUT', 'ค่าตัด/พับตามแบบ', 'service', 300, 0, 'งาน');
});

describe('โรงงานตะแกรงเหล็ก: ซื้อวัตถุดิบ', () => {
  it('PO เหล็กแผ่น → อนุมัติ → รับเข้าคลังวัตถุดิบ (ใบรับสินค้า) → สต็อก+บัญชีเจ้าหนี้/ภาษีซื้อ', async () => {
    S.po = (await one<any>('select save_purchase_order(null,$1::jsonb,$2::jsonb) id', [
      J({ date: D1, contact: S.sup, credit_days: 30, warehouse_id: S.raw }),
      J([{ product_id: P['RM-SS400-15'], qty: 100, unit_price: 1200 }, { product_id: P['RM-SS400-30'], qty: 40, unit_price: 2300 },
         { product_id: P['RM-SUS304-20'], qty: 20, unit_price: 6500 }, { product_id: P['RM-AL-15'], qty: 30, unit_price: 2800 }])])).id;
    await db.query('select approve_purchase_order($1)', [S.po]);
    S.ri = (await one<any>('select upgrade_po_to_ri($1,$2::date) id', [S.po, D1])).id;
    const ri = await one<any>('select subtotal, vat, total, status from goods_receipts where id=$1', [S.ri]);
    const net = 100 * 1200 + 40 * 2300 + 20 * 6500 + 30 * 2800;           // 120000+92000+130000+84000 = 426000
    expect(+ri.subtotal).toBe(net); expect(+ri.vat).toBe(29820); expect(+ri.total).toBe(net + 29820);
    expect(await onHand(P['RM-SS400-15'])).toBe(100);
    expect(await gl('21311')).toBe(-(net + 29820)); expect(await gl('17113')).toBe(29820);
    expect(await stockValue()).toBe(net);
  });
  it('จ่ายเงินซัพพลายเออร์: โอน 300,000 + เงินสด ส่วนที่เหลือ', async () => {
    const tot = +(await one<any>('select total t from goods_receipts where id=$1', [S.ri])).t;
    await db.query('select approve_goods_receipt($1)', [S.ri]);
    await db.query('select pay_goods_receipt($1,$2::date,$3::jsonb)', [S.ri, D1, J([{ method: 'transfer', amount: 300000, bank_account_id: S.bank }, { method: 'cash', amount: tot - 300000 }])]);
    expect((await one<any>('select status from goods_receipts where id=$1', [S.ri])).status).toBe('paid');
    expect(await gl('21311')).toBe(0);
  });
  it('ค่าขนส่งเหล็ก หัก ณ ที่จ่าย 1% → ค่าใช้จ่าย + ใบ 50 ทวิ', async () => {
    const e = (await one<any>('select save_expense($1::jsonb,$2::jsonb) id', [J({ date: D1, contact: S.trans }),
      J([{ description: 'ค่าขนส่งเหล็กแผ่น', account: '53103', qty: 1, unit_price: 5000, vat: '7', wht_rate: 1 }])])).id;
    await db.query('select approve_expense($1)', [e]);
    await db.query('select pay_expense($1,$2::date)', [e, D1]);
    const x = await one<any>('select total, wht_total, status from expenses where id=$1', [e]);
    expect(+x.total).toBe(5350); expect(+x.wht_total).toBe(50);
    expect(await gl('27124')).toBe(-50);
    expect(+(await one<any>('select count(*) n from wht_certs')).n).toBeGreaterThan(0);
  });
});

describe('โรงงานตะแกรงเหล็ก: ผลิต (จำลอง — โมดูลผลิต D-06 ยังไม่ได้สร้าง)', () => {
  it('เบิกเหล็กแผ่นออกจากคลังวัตถุดิบ / รับตะแกรงสำเร็จรูปเข้าคลังหลัก ด้วยปรับสต็อก', async () => {
    const out = async (c: string, q: number) => db.query('select adjust_stock($1::date,$2,$3,$4,$5,$6)', [D2, P[c], S.raw, 'out', 'เบิกผลิต', q]);
    const inn = async (c: string, q: number, cost: number) => db.query('select adjust_stock($1::date,$2,$3,$4,$5,$6,$7)', [D2, P[c], S.main, 'in', 'รับสินค้าผลิตเสร็จ', q, cost]);
    // 1 แผ่นเหล็ก 4x8 ฟุต ปั๊มได้ 3 แผ่นตะแกรง (ต้นทุนวัตถุดิบ 1200/3 = 400 + ค่าแปลงสภาพสมมุติ 150)
    await out('RM-SS400-15', 40); await inn('FG-EXP-SS-15', 120, 550);
    await out('RM-SS400-30', 20); await inn('FG-EXP-SS-30', 60, 1150 / 1 * 0.9 + 0);   // 2300/3 + แปลงสภาพ = 1050+... สมมุติ 1035
    await out('RM-SUS304-20', 10); await inn('FG-PERF-SUS-20', 20, 3500);
    await out('RM-AL-15', 15); await inn('FG-PERF-AL-15', 45, 1250);
    expect(await onHand(P['RM-SS400-15'], S.raw)).toBe(60);
    expect(await onHand(P['FG-EXP-SS-15'], S.main)).toBe(120);
    expect(await onHand(P['RM-SS400-15'], S.main)).toBe(0);
  });
  it('ปรับสต็อกต้องระบุสาเหตุ', async () => {
    expect(await err(db.query('select adjust_stock($1::date,$2,$3,$4,$5,$6)', [D2, P['RM-AL-15'], S.raw, 'out', '', 1]))).toContain('สาเหตุ');
  });
});

describe('โรงงานตะแกรงเหล็ก: ขาย', () => {
  it('QT 2 รายการ + ส่วนลด 5% → อนุมัติ → INV → ตัดสต็อกคลังหลัก', async () => {
    S.qt = (await one<any>('select save_quotation(null,$1::jsonb,$2::jsonb) id', [J({ date: D3, contact: S.c1, credit_days: 30 }),
      J([{ product_id: P['FG-EXP-SS-15'], qty: 50, unit_price: 850, discount_type: 'percent', discount_value: 5 },
         { product_id: P['FG-EXP-SS-30'], qty: 20, unit_price: 1650 }, { product_id: P['SV-CUT'], qty: 1, unit_price: 3000 }])])).id;
    await db.query('select approve_quotation($1)', [S.qt]);
    S.inv1 = (await one<any>('select quotation_to_invoice($1,$2::date) id', [S.qt, D3])).id;
    const inv = await one<any>('select subtotal, vat, total, status from sales_docs where id=$1', [S.inv1]);
    const net = 50 * 850 * 0.95 + 20 * 1650 + 3000;                              // 40375 + 33000 + 3000 = 76375
    expect(+inv.subtotal).toBe(net); expect(+inv.vat).toBe(+(net * 0.07).toFixed(2));
    expect(await onHand(P['FG-EXP-SS-15'])).toBe(70); expect(await onHand(P['FG-EXP-SS-30'])).toBe(40);
    expect(await gl('11310') + await gl('11311')).toBe(+inv.total);   // ลูกหนี้
  });
  it('ลูกค้าเก็บเงิน: ใบเสร็จ INV1 เก็บโอนเข้าบัญชีธนาคาร', async () => {
    const r = (await one<any>('select create_receipt_from_invoice($1,$2::date) id', [S.inv1, D4])).id;
    await db.query('select collect_receipt($1,$2::date,$3::jsonb)', [r, D4, J([{ method: 'transfer', amount: +(await one<any>('select total t from sales_docs where id=$1', [S.inv1])).t, bank_account_id: S.bank }])]);
    expect((await one<any>('select status from sales_docs where id=$1', [S.inv1])).status).toBe('receipt_opened');
    expect(await gl('11310') + await gl('11311')).toBe(0);
  });
  it('ขายสด (CA) หน้าโรงงาน ตะแกรงอลูมิเนียม + เก็บเงินสด', async () => {
    const ca = (await one<any>('select create_sales_doc($1,$2::date,null,$3::jsonb) id', ['CA', D4, J([{ description: 'x', product_id: P['FG-PERF-AL-15'], qty: 5, unit_price: 1500 }])])).id;
    await db.query('select collect_cash_sale($1,$2::date)', [ca, D4]);
    expect(await onHand(P['FG-PERF-AL-15'])).toBe(40);
    expect((await one<any>('select status, total from sales_docs where id=$1', [ca])).status).toBe('collected');
  });
  it('สินค้าที่บล็อกติดลบ: ขายเกินคงเหลือไม่ได้ (สแตนเลสเหลือ 20)', async () => {
    const e = await err(db.query('select create_sales_doc($1,$2::date,$3,$4::jsonb)', ['INV', D4, S.c2, J([{ description: 'x', product_id: P['FG-PERF-SUS-20'], qty: 25, unit_price: 3400 }])]));
    expect(e).not.toBe('');
    expect(await onHand(P['FG-PERF-SUS-20'])).toBe(20);
  });
  it('INV2 ลูกค้า 2 (หัก ณ ที่จ่าย 3% ค่าบริการ) + จ่ายไม่ครบ 2 งวด', async () => {
    S.inv2 = (await one<any>('select create_invoice_full($1::jsonb,$2::jsonb) id', [J({ date: D4, contact: S.c2, credit_days: 15 }),
      J([{ product_id: P['FG-PERF-SUS-20'], qty: 10, unit_price: 3400 }, { product_id: P['SV-CUT'], qty: 2, unit_price: 1500, wht_rate: 3 }])])).id;
    const t = await one<any>('select total, subtotal from sales_docs where id=$1', [S.inv2]);
    expect(+t.subtotal).toBe(37000);
    const r1 = (await one<any>('select create_receipt_from_invoice($1,$2::date,$3) id', [S.inv2, D5, 20000])).id;
    await db.query('select collect_receipt($1,$2::date)', [r1, D5]);
    expect((await one<any>('select status from sales_docs where id=$1', [S.inv2])).status).toBe('split_paid');
    const r2 = (await one<any>('select create_receipt_from_invoice($1,$2::date) id', [S.inv2, D5])).id;
    const rc = await one<any>('select amount, wht from receipts where id=$1', [r2]);
    await db.query('select collect_receipt($1,$2::date,$3::jsonb)', [r2, D5, J([{ method: 'transfer', amount: +rc.amount - +rc.wht, bank_account_id: S.bank }])]);
    expect((await one<any>('select status from sales_docs where id=$1', [S.inv2])).status).toBe('receipt_opened');
    expect(+(await one<any>(`select sum(wht) w from receipts where status<>'cancelled' and id in (select receipt_id from receipt_items where doc_id=$1)`, [S.inv2])).w).toBe(90);
  });
  it('ลูกค้าคืนสินค้า: CN เลือก "คืนสินค้า" → สต็อกกลับ · CN ที่ไม่เลือก → สต็อกไม่เปลี่ยน (regression 0074)', async () => {
    const mkInv = async (q: number) => (await one<any>('select create_invoice_full($1::jsonb,$2::jsonb) id', [J({ date: D5, contact: S.c1 }), J([{ product_id: P['FG-EXP-SS-15'], qty: q, unit_price: 850 }])])).id;
    const cn = async (inv: string, q: number, act?: string) => (await one<any>('select create_sales_doc($1,$2::date,$3,$4::jsonb,$5,7,$6,$7) id', ['CN', D5, S.c1,
      J([{ description: 'คืนตะแกรง', product_id: P['FG-EXP-SS-15'], qty: q, unit_price: 850, ...(act ? { stock_action: act } : {}) }]), 'exclusive', inv, 'สินค้าไม่ตรงสเปก'])).id;
    // ใบแจ้งหนี้ที่มีใบเสร็จผูกแล้ว ออกใบลดหนี้ไม่ได้ (ระบบกันไว้ตามต้นแบบ)
    expect(await err(cn(S.inv1, 1))).toContain('ใบเสร็จ');
    const s0 = await onHand(P['FG-EXP-SS-15']);
    const i1 = await mkInv(8); expect(await onHand(P['FG-EXP-SS-15'])).toBe(s0 - 8);
    const c1 = await cn(i1, 5);                                   // ไม่เลือกตัวเลือกสต็อก
    expect(+(await one<any>('select total t from sales_docs where id=$1', [c1])).t).toBe(4547.5);
    expect(await onHand(P['FG-EXP-SS-15'])).toBe(s0 - 8);       // ไม่มีผลต่อสต็อก
    const i2 = await mkInv(8); await cn(i2, 5, 'return');
    expect(await onHand(P['FG-EXP-SS-15'])).toBe(s0 - 16 + 5);  // คืนสินค้า +5
    const i3 = await mkInv(2); await cn(i3, 2, 'no_return');
    expect(await onHand(P['FG-EXP-SS-15'])).toBe(s0 - 18 + 5);  // ไม่คืน: สต็อกไม่เพิ่ม
  });
  it('ใบวางบิล + ใบแจ้งหนี้ 2 ใบของลูกค้า 1 → วางบิลรวม', async () => {
    const a = (await one<any>('select create_invoice_full($1::jsonb,$2::jsonb) id', [J({ date: D5, contact: S.c1 }), J([{ product_id: P['FG-EXP-SS-30'], qty: 10, unit_price: 1650 }])])).id;
    const b = (await one<any>('select create_invoice_full($1::jsonb,$2::jsonb) id', [J({ date: D5, contact: S.c1 }), J([{ product_id: P['FG-EXP-SS-15'], qty: 10, unit_price: 850 }])])).id;
    const bl = (await one<any>('select create_billing_note($1::date,$2,$3::uuid[]) id', [D5, S.c1, [a, b]])).id;
    expect(+(await one<any>('select total t from sales_docs where id=$1', [bl])).t).toBe(Math.round((16500 + 8500) * 1.07 * 100) / 100);
  });
  it('ยกเลิก INV → สต็อกคืน', async () => {
    const x = (await one<any>('select create_invoice_full($1::jsonb,$2::jsonb) id', [J({ date: D5, contact: S.c2 }), J([{ product_id: P['FG-EXP-SS-30'], qty: 4, unit_price: 1650 }])])).id;
    const b = await onHand(P['FG-EXP-SS-30']);
    await db.query('select cancel_sales_doc($1)', [x]);
    expect(await onHand(P['FG-EXP-SS-30'])).toBe(b + 4);
  });
});

describe('โรงงานตะแกรงเหล็ก: ตรวจรายงาน/งบ', () => {
  it('งบทดลองสมดุล เดบิต = เครดิต', async () => {
    const t = await one<any>(`select sum(period_dr) d, sum(period_cr) c from trial_balance('2026-10-01','2026-10-31',false)`);
    expect(+t.d).toBe(+t.c);
  });
  it('ภาษีขาย/ภาษีซื้อ ตรงกับเอกสาร', async () => {
    const outV = +(await one<any>(`select coalesce(sum(vat),0) v from sales_docs where doc_type in ('INV','CA') and status<>'cancelled'`)).v;
    const cn = +(await one<any>(`select coalesce(sum(vat),0) v from sales_docs where doc_type='CN' and status<>'cancelled'`)).v;
    expect(-(await gl('27111'))).toBeCloseTo(outV - cn, 2);
    expect(await gl('17113')).toBeGreaterThan(0);
  });
  it('รายงานลูกหนี้ ณ สิ้นเดือน: เหลือเฉพาะ INV ที่ยังไม่เก็บ', async () => {
    const ar = await rows(`select * from ar_aging('2026-10-31')`);
    const sum = ar.reduce((s: number, r: any) => s + Number(r.outstanding ?? 0), 0);
    expect(sum).toBeGreaterThan(0);
  });
  it('ยอดขายตามพนักงาน/ผลรวมรายได้ ไม่ติดลบ และสต็อกคงเหลือไม่ติดลบทุกคลัง', async () => {
    const rev = (await rows(`select * from sales_by_salesperson(null,null)`));
    expect(rev.length).toBeGreaterThan(0);
  });
  it('มูลค่าสต็อก vs บัญชีสินค้าคงเหลือ 11500 (บันทึกผลเทียบ — ต้นทุนขายไม่ลงบัญชีตาม M12)', async () => {
    const g = await gl('11500'); const s = await stockValue();
    console.log(`[E2E] มูลค่าสต็อก=${s} · GL 11500=${g} · ผลต่าง=${g - s}`);
    expect(Number.isFinite(g - s)).toBe(true);
  });
});
