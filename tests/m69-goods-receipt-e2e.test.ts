import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { COA } from '../web/lib/seed';

// M69 ตรวจใบรับสินค้าแบบครบวงจร ตามสถานการณ์จริงของ TMP: ซื้อแผ่นเหล็กเรียบ เหล็กดำ 1.5 x 1219 x 2438 มม. 100 แผ่น @850
const dir = new URL('../supabase/migrations/', import.meta.url);
let db: PGlite;
const J = JSON.stringify;
const q = async (s: string, a: unknown[] = []) => (await db.query<any>(s, a)).rows;
const one = async (s: string, a: unknown[] = []) => (await q(s, a))[0];
const err = async (p: Promise<unknown>) => { try { await p; return ''; } catch (e) { return (e as Error).message; } };
const oh = async (p: string) => +(await one('select stock_on_hand($1,null) v', [p])).v;
const val = async (p: string) => +(await one('select value from product_stock where product_id=$1', [p])).value;
const gl = async (code: string) => +(await one(`select coalesce(sum(l.debit-l.credit),0) b from journal_lines l join accounts a on a.id=l.account_id where a.code=$1`, [code])).b;
const ri = async (id: string) => one('select ri_no, status, subtotal::float s, vat::float v, total::float t from goods_receipts where id=$1', [id]);
const edit = (id: string, lines: object[], h: object = {}) => db.query('select update_goods_receipt($1,$2::jsonb,$3::jsonb)', [id, J(h), J(lines)]);
const save = async (h: object, l: object[]) => (await one('select save_goods_receipt($1::jsonb,$2::jsonb) id', [J(h), J(l)])).id as string;
let sup = '', sheet = '';
const L = (qty: number, price = 850) => [{ product_id: sheet, qty, unit_price: price }];
const newPo = async (qty = 100, price = 850) => {
  const id = (await one('select save_purchase_order(null,$1::jsonb,$2::jsonb) id', [J({ date: '2026-11-02', contact: sup, credit_days: 30 }), J(L(qty, price))])).id;
  await db.query('select approve_purchase_order($1)', [id]); return id as string;
};
const split = async (po: string, qty: number, d = '2026-11-06') => (await one(`select split_ri_from_po_qty($1,$2::date,$3::jsonb) id`, [po, d, J([{ line_no: 1, qty }])])).id as string;
const balances = async () => (await q(`select sum(qty_in-qty_out) over (order by move_date, seq)::float b from stock_movements where product_id=$1 and voided_at is null order by move_date, seq`, [sheet])).map(r => r.b);

beforeAll(async () => {
  db = new PGlite();
  for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(new URL(f, dir), 'utf8'));
  for (const [c, n, t] of COA) await db.query('insert into accounts(code,name,type) values ($1,$2,$3) on conflict (code) do update set name=excluded.name,type=excluded.type', [c, n, t]);
  sup = (await one(`insert into contacts(business_name,tax_id) values ('Test Steel Supplier Co., Ltd.','0105599999991') returning id`)).id;
  sheet = (await one(`insert into products(code,name,kind,sale_price,purchase_price,base_unit) values ('RM-MS15-4x8','แผ่นเหล็กเรียบ เหล็กดำ 1.5x1219x2438 มม.','goods_stock',0,850,'แผ่น') returning id`)).id;
});

describe('ขั้นที่ 1–8: PO → RI → สต็อก → บัญชี', () => {
  let po = '', r1 = '';
  it('PO 100 แผ่น = 85,000 + VAT 5,950 = 90,950 · PO ไม่กระทบสต็อก/บัญชี', async () => {
    po = await newPo();
    expect(await one('select subtotal::float s, vat::float v, total::float t from purchase_orders where id=$1', [po])).toEqual({ s: 85000, v: 5950, t: 90950 });
    expect(await oh(sheet)).toBe(0);
    expect(+(await one('select count(*) n from journal_vouchers')).n).toBe(0);
  });
  it('RI จาก PO: สต็อก +100 @850 (มูลค่า 85,000) · UV Dr ซื้อ 85,000 / Dr ภาษีซื้อรอ 5,950 / Cr เจ้าหนี้ 90,950 · PO ดำเนินการแล้ว', async () => {
    r1 = (await one(`select upgrade_po_to_ri($1,'2026-11-05'::date) id`, [po])).id;
    expect(await ri(r1)).toMatchObject({ status: 'unpaid', s: 85000, v: 5950, t: 90950 });
    expect(await oh(sheet)).toBe(100); expect(await val(sheet)).toBe(85000);
    expect(await gl('51111.01')).toBe(85000); expect(await gl('17113')).toBe(5950); expect(await gl('21311')).toBe(-90950);
    expect((await one('select status from purchase_orders where id=$1', [po])).status).toBe('converted');
  });
  it('กดสร้าง RI จาก PO ซ้ำไม่ได้ (กันรับซ้ำ/ลงบัญชีซ้ำ)', async () => {
    expect(await err(one(`select upgrade_po_to_ri($1)`, [po]))).toContain('ได้เฉพาะใบสั่งซื้อที่รออนุมัติหรืออนุมัติแล้ว');
    expect(+(await one(`select count(*) n from goods_receipts where po_id=$1`, [po])).n).toBe(1);
  });
  it('ขั้นที่ 9: สต็อกพร้อมเบิกใช้ (จำลองการเบิกผลิตด้วยการปรับลด เพราะยังไม่มีโมดูลผลิต) ต้นทุน 850/แผ่น', async () => {
    const adj = (await one(`select adjust_stock('2026-11-10'::date,$1,main_warehouse(),'out','เบิกผลิต (จำลอง)',30) id`, [sheet])).id;
    expect(+(await one('select unit_cost from stock_movements where doc_id=$1', [adj])).unit_cost).toBe(850);
    expect(await oh(sheet)).toBe(70); expect(await val(sheet)).toBe(59500);
  });
});

describe('สถานการณ์ A/B: แก้ใบรับสินค้า', () => {
  it('A รออนุมัติ: 100 → 80 แผ่น ราคา 860 → กลับ UV เดิม (-R) + UV ใหม่ · สต็อกเดิม void แล้วรับใหม่ · มีประวัติ', async () => {
    const id = await save({ date: '2026-11-11', contact: sup }, L(100));
    const v0 = (await one('select uv_voucher_id v from goods_receipts where id=$1', [id])).v;
    const ap0 = await gl('21311'), oh0 = await oh(sheet);
    await edit(id, L(80, 860));
    expect(await ri(id)).toMatchObject({ s: 68800, v: 4816, t: 73616 });
    expect(await oh(sheet)).toBe(oh0 - 20);
    expect(await gl('21311')).toBe(ap0 + 90950 - 73616);
    expect(+(await one('select count(*) n from journal_vouchers where reverses_id=$1', [v0])).n).toBe(1);
    expect(+(await one(`select count(*) n from stock_movements where doc_id=$1 and voided_at is not null`, [id])).n).toBe(1);
    expect((await q(`select detail from purchase_doc_events where doc_id=$1 and event='edit'`, [id])).map(r => r.detail)).toEqual(['ยอดรวม 90,950.00 → 73,616.00']);
  });
  it('B อนุมัติแล้ว: 100 → 90 ได้ (ใช้วิธีเดียวกัน) · จ่ายแล้วแก้ไม่ได้ต้องรีเซ็ตก่อน', async () => {
    const id = await save({ date: '2026-11-11', contact: sup }, L(100));
    await db.query('select approve_goods_receipt($1)', [id]);
    await edit(id, L(90));
    expect(await ri(id)).toMatchObject({ status: 'approved', t: 81855 });
    await db.query(`select pay_goods_receipt($1,'2026-11-12'::date,'11112')`, [id]);
    expect(await err(edit(id, L(80)))).toContain('รีเซ็ตก่อน');
  });
});

describe('สถานการณ์ C: ยกเลิก', () => {
  it('ยกเลิก RI ที่จ่ายแล้ว: กลับทั้ง PV และ UV (-R) สต็อกออก เอกสารยังอยู่สถานะยกเลิก · ยกเลิกซ้ำไม่ได้', async () => {
    const id = await save({ date: '2026-11-13', contact: sup }, L(10));
    await db.query(`select pay_goods_receipt($1,'2026-11-14'::date,'11112')`, [id]);
    const oh0 = await oh(sheet), ap0 = await gl('21311'), cash0 = await gl('11112');
    await db.query('select cancel_goods_receipt($1)', [id]);
    expect((await ri(id)).status).toBe('cancelled');
    expect(await oh(sheet)).toBe(oh0 - 10); expect(await gl('21311')).toBe(ap0); expect(await gl('11112')).toBe(cash0 + 9095);
    expect((await q(`select voucher_no from journal_vouchers where source_id=$1 or reverses_id in (select id from journal_vouchers where source_id=$1) order by 1`, [id])).map(r => r.voucher_no))
      .toEqual(expect.arrayContaining([expect.stringMatching(/^UV\d+-R$/), expect.stringMatching(/^PV\d+-R$/)]));
    expect(await err(db.query('select cancel_goods_receipt($1)', [id]))).toContain('ยกเลิกแล้ว');
  });
});

describe('สถานการณ์ D: รับบางส่วน 60 + 40', () => {
  it('รับ 60 → PO รับบางส่วน คงเหลือ 40 · รับเกิน 41 ไม่ได้ · รับ 40 → ครบ · VAT รวมตรงกับ PO', async () => {
    const po = await newPo(); const oh0 = await oh(sheet);
    const a = await split(po, 60);
    expect((await one('select status from purchase_orders where id=$1', [po])).status).toBe('partial');
    expect(+(await one('select po_line_billed_qty($1,1) v', [po])).v).toBe(60);
    expect(await err(split(po, 41))).toContain('เกินจำนวนคงเหลือ');
    await split(po, 40, '2026-11-07');
    expect((await one('select status from purchase_orders where id=$1', [po])).status).toBe('converted');
    expect(await oh(sheet)).toBe(oh0 + 100);
    expect(await one('select sum(total)::float t, sum(vat)::float v from goods_receipts where po_id=$1', [po])).toEqual({ t: 90950, v: 5950 });
    expect(await err(edit(a, [{ line_no: 1, qty: 70 }]))).toContain('เหลือจำนวนที่แบ่งได้ 60');
    await db.query('select cancel_goods_receipt($1)', [a]);
    expect((await one('select status from purchase_orders where id=$1', [po])).status).toBe('partial');
  });
  it('เศษสตางค์: PO 3 × 333.33 แบ่งรับ 1+1+1 → ยอดรวม/VAT รวม เท่ากับ PO', async () => {
    const po = await newPo(3, 333.33);
    for (const d of ['2026-11-15', '2026-11-15', '2026-11-15']) await split(po, 1, d);
    expect(await one('select sum(total)::float t, sum(vat)::float v from goods_receipts where po_id=$1', [po]))
      .toEqual(await one('select total::float t, vat::float v from purchase_orders where id=$1', [po]));
  });
});

describe('สถานการณ์ E: ข้อผิดพลาด', () => {
  it('ข้อมูลไม่ครบ/ไม่ถูกต้อง ได้ข้อความตรงสาเหตุ (M69 แก้ข้อความ)', async () => {
    expect(await err(save({ date: '2026-11-16' }, L(1)))).toContain('ต้องเลือกผู้จำหน่าย');
    expect(await err(save({ date: '2026-11-16', contact: sup }, [{ qty: 1, unit_price: 850 }]))).toContain('สินค้านับสต็อก');
    expect(await err(save({ date: '2026-11-16', contact: sup }, L(0)))).toContain('จำนวนต้องมากกว่า 0');
    expect(await err(save({ date: '2026-11-16', contact: sup }, L(-5)))).toContain('จำนวนต้องมากกว่า 0');
    expect(await err(save({ date: '2026-11-16', contact: sup }, L(1, -1)))).toContain('ราคาต่อหน่วยต้องไม่ติดลบ');
    expect(await err(save({ date: '2026-11-16', contact: sup }, [{ product_id: sheet, qty: 1, unit_price: 850, discount_value: -10 }]))).toContain('ส่วนลดต้องไม่ติดลบ');
    expect(await err(save({ date: '2026-11-16', contact: sup }, []))).toContain('อย่างน้อย 1 บรรทัด');
  });
  it('ของที่รับถูกเบิกไปแล้ว: แก้/ยกเลิก/ไม่อนุมัติไม่ได้ แม้มีของเข้ามาชดเชยทีหลัง (M69 แก้ — เดิมทำให้สต็อกติดลบย้อนหลัง)', async () => {
    const p2 = (await one(`insert into products(code,name,kind,sale_price,base_unit) values ('RM2','แผ่นเหล็ก 2','goods_stock',0,'แผ่น') returning id`)).id;
    const r = await save({ date: '2026-11-05', contact: sup }, [{ product_id: p2, qty: 80, unit_price: 850 }]);
    await one(`select adjust_stock('2026-11-10'::date,$1,main_warehouse(),'out','เบิกผลิต',30)`, [p2]);
    await save({ date: '2026-11-12', contact: sup }, [{ product_id: p2, qty: 50, unit_price: 900 }]);
    expect(await err(edit(r, [{ product_id: p2, qty: 20, unit_price: 850 }]))).toContain('ถูกใช้ไปแล้ว');
    expect(await err(db.query('select cancel_goods_receipt($1)', [r]))).toContain('ถูกใช้ไปแล้ว');
    expect(await err(db.query('select reject_goods_receipt($1)', [r]))).toContain('ถูกใช้ไปแล้ว');
    const bal = (await q(`select sum(qty_in-qty_out) over (order by move_date, seq)::float b from stock_movements where product_id=$1 and voided_at is null order by move_date, seq`, [p2])).map(x => x.b);
    expect(bal).toEqual([80, 50, 100]);   // ไม่มีค่าติดลบ และไม่มีผลค้างจากคำสั่งที่ล้ม
  });
  it('ของที่รับยังไม่ถูกใช้หลังวันที่รับ (ใช้ก่อนหน้า) แก้ได้ตามปกติ', async () => {
    const p3 = (await one(`insert into products(code,name,kind,sale_price,base_unit) values ('RM3','แผ่นเหล็ก 3','goods_stock',0,'แผ่น') returning id`)).id;
    await save({ date: '2026-11-01', contact: sup }, [{ product_id: p3, qty: 10, unit_price: 850 }]);
    await one(`select adjust_stock('2026-11-02'::date,$1,main_warehouse(),'out','เบิกผลิต',10)`, [p3]);
    const r = await save({ date: '2026-11-20', contact: sup }, [{ product_id: p3, qty: 5, unit_price: 850 }]);
    await edit(r, [{ product_id: p3, qty: 3, unit_price: 850 }]);
    expect(+(await one('select stock_on_hand($1,null) v', [p3])).v).toBe(3);
  });
  it('งวดที่ล็อก: สร้าง/แก้/ยกเลิก/ไม่อนุมัติ/ย้ายวันที่เข้างวด ไม่ได้', async () => {
    const r = await save({ date: '2026-11-03', contact: sup }, L(10));
    const other = await save({ date: '2026-11-21', contact: sup }, L(1));
    await one(`select lock_period('2026-11-01','2026-11-04','ปิดงวด')`);
    for (const p of [save({ date: '2026-11-03', contact: sup }, L(1)), edit(r, L(5)), db.query('select cancel_goods_receipt($1)', [r]),
      db.query('select reject_goods_receipt($1)', [r]), edit(other, L(1), { date: '2026-11-03' })])
      expect(await err(p)).toContain('PERIOD_LOCKED');
    expect((await ri(r)).status).toBe('unpaid');
  });
});


describe('M69.1 กฎรับสินค้าจาก PO (เจ้าของระบบตัดสินใจ 18-11-2026)', () => {
  const mkP = async (c: string) => (await one(`insert into products(code,name,kind,sale_price,base_unit) values ($1,$1,'goods_stock',0,'แผ่น') returning id`, [c])).id as string;
  const mkPo = async (p: string, qty: number, approve = true) => {
    const id = (await one('select save_purchase_order(null,$1::jsonb,$2::jsonb) id', [J({ date: '2026-11-20', contact: sup }), J([{ product_id: p, qty, unit_price: 850 }])])).id;
    if (approve) await db.query('select approve_purchase_order($1)', [id]); return id as string;
  };
  const st = async (po: string) => (await one('select status from purchase_orders where id=$1', [po])).status;
  it('ข้อ 1: รีเซ็ต PO แล้วสร้าง/แบ่งรับซ้ำไม่ได้ขณะใบเดิมยังมีผล · ยกเลิกใบเดิมแล้วสร้างใหม่ได้ (สต็อกไม่ซ้ำ)', async () => {
    const p = await mkP('R1'); const po = await mkPo(p, 100);
    const r1 = (await one(`select upgrade_po_to_ri($1) id`, [po])).id;
    await db.query('select reset_purchase_order($1)', [po]);
    expect(await err(one(`select upgrade_po_to_ri($1)`, [po]))).toContain('ยังมีผลอยู่');
    await db.query('select approve_purchase_order($1)', [po]);
    expect(await err(one(`select split_ri_from_po_qty($1,'2026-11-20'::date,'[{"line_no":1,"qty":100}]'::jsonb)`, [po]))).toContain('ยังมีผลอยู่');
    expect(await oh(p)).toBe(100);
    await db.query('select cancel_goods_receipt($1)', [r1]);
    await one(`select upgrade_po_to_ri($1) id`, [po]);
    expect(await oh(p)).toBe(100);
  });
  it('ข้อ 1: RI ที่ไม่อนุมัติแล้วมีใบใหม่ → รีเซ็ตใบเก่ากลับมามีผลไม่ได้', async () => {
    const p = await mkP('R2'); const po = await mkPo(p, 10, false);
    const r1 = (await one(`select upgrade_po_to_ri($1) id`, [po])).id;
    await db.query('select reject_goods_receipt($1)', [r1]); await db.query('select reset_purchase_order($1)', [po]);
    await one(`select upgrade_po_to_ri($1) id`, [po]);
    expect(await err(db.query('select reset_goods_receipt($1)', [r1]))).toContain('ยังมีผลอยู่');
    expect(await oh(p)).toBe(10);
  });
  it('ข้อ 2: แก้ RI เต็มใบเกิน PO ต้องยืนยัน · ยืนยันแล้วบันทึกได้', async () => {
    const p = await mkP('R3'); const po = await mkPo(p, 100);
    const r = (await one(`select upgrade_po_to_ri($1) id`, [po])).id;
    expect(await err(edit(r, [{ product_id: p, qty: 120, unit_price: 850 }]))).toContain('OVER_PO');
    expect(await oh(p)).toBe(100);
    await edit(r, [{ product_id: p, qty: 120, unit_price: 850 }], { allow_over_po: true });
    expect(await oh(p)).toBe(120); expect(await st(po)).toBe('converted');
  });
  it('ข้อ 2: แก้ลด 100 → 80 → PO แบ่งจ่าย รับ 20 ที่เหลือได้ เกิน 20 ไม่ได้ · ครบแล้ว PO ดำเนินการแล้ว', async () => {
    const p = await mkP('R4'); const po = await mkPo(p, 100);
    const r = (await one(`select upgrade_po_to_ri($1) id`, [po])).id;
    await edit(r, [{ product_id: p, qty: 80, unit_price: 850 }]);
    expect(await st(po)).toBe('partial');
    expect(+(await one('select po_line_billed_qty($1,1) v', [po])).v).toBe(80);
    expect(await err(one(`select split_ri_from_po_qty($1,'2026-11-21'::date,'[{"line_no":1,"qty":21}]'::jsonb)`, [po]))).toContain('เกินจำนวนคงเหลือ');
    await one(`select split_ri_from_po_qty($1,'2026-11-21'::date,'[{"line_no":1,"qty":20}]'::jsonb)`, [po]);
    expect(await st(po)).toBe('converted'); expect(await oh(p)).toBe(100);
    // ใบแรกแก้กลับขึ้นได้ไม่เกินที่เหลือ
    expect(await err(edit(r, [{ line_no: 1, qty: 81 }]))).toContain('เหลือจำนวนที่แบ่งได้ 80');
  });
  it('ข้อ 2: แก้ลดพร้อมแก้ราคา → คงเป็นรับเต็มใบ (ใบแบ่งรับล็อกราคาตาม PO)', async () => {
    const p = await mkP('R5'); const po = await mkPo(p, 4);
    const r = (await one(`select upgrade_po_to_ri($1) id`, [po])).id;
    await edit(r, [{ product_id: p, qty: 3, unit_price: 900 }]);
    expect((await one('select split_mode from goods_receipts where id=$1', [r])).split_mode).toBeNull();
    expect(await st(po)).toBe('converted');
  });
});
