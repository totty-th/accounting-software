import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { COA } from '../web/lib/seed';

// แก้ RI หลังบันทึก: ใบกลับรายการ -R + UV ใหม่ (เจ้าของตัดสินใจ 15-11-2026 · กฎล็อกช่องตามผลทดสอบ FA)
const dir = new URL('../supabase/migrations/', import.meta.url);
let db: PGlite;
const one = async <T = any>(q: string, a: unknown[] = []) => (await db.query<any>(q, a)).rows[0] as T;
const J = JSON.stringify;
const err = async (p: Promise<unknown>) => { try { await p; return ''; } catch (e) { return (e as Error).message; } };
const onHand = async (p: string) => +(await one<any>('select stock_on_hand($1,null) v', [p])).v;
const revs = async () => +(await one<any>(`select count(*) c from journal_vouchers where voucher_no like '%-R'`)).c;
let sup = '', a = '', po = '';

beforeAll(async () => {
  db = new PGlite();
  for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(new URL(f, dir), 'utf8'));
  for (const [c, n, t] of COA) await db.query('insert into accounts(code,name,type) values ($1,$2,$3) on conflict (code) do update set name=excluded.name,type=excluded.type', [c, n, t]);
  sup = (await one<any>(`insert into contacts(business_name,tax_id) values ('ซัพพลายเออร์','0105522222222') returning id`)).id;
  a = (await one<any>(`insert into products(code,name,kind,sale_price,purchase_price,base_unit) values ('A','A','goods_stock',0,100,'ชิ้น') returning id`)).id;
});
const mk = async (qty: number, extra: object = {}) =>
  (await one<any>('select save_goods_receipt($1::jsonb,$2::jsonb) id', [J({ date: '2026-11-04', contact: sup }), J([{ product_id: a, qty, unit_price: 100, ...extra }])])).id;
const upd = async (id: string, h: object, lines: unknown[]) => one<any>('select update_goods_receipt($1,$2::jsonb,$3::jsonb) id', [id, J(h), J(lines)]);

describe('แก้ RI หลังบันทึก', () => {
  it('RI ทั่วไป: แก้จำนวน/ราคา/ส่วนลด → UV เดิมได้ -R, UV ใหม่, สต็อกและยอดตาม', async () => {
    const id = await mk(3);
    expect(await onHand(a)).toBe(3);
    const r0 = await revs();
    await upd(id, { ref_no: 'X1' }, [{ product_id: a, qty: 2, unit_price: 110, discount_type: 'percent', discount_value: 10 }]);
    const r = await one<any>('select * from goods_receipts where id=$1', [id]);
    expect([+r.subtotal, +r.vat, +r.total, +r.discount_total, r.ref_no]).toEqual([198, 13.86, 211.86, 22, 'X1']);
    expect(await revs()).toBe(r0 + 1);
    expect(await onHand(a)).toBe(2);
    const gl = await one<any>(`select sum(l.debit) d, sum(l.credit) c from journal_lines l where l.voucher_id=$1`, [r.uv_voucher_id]);
    expect([+gl.d, +gl.c]).toEqual([211.86, 211.86]);
  });
  it('จ่ายแล้ว/ไม่อนุมัติแก้ไม่ได้ · ใบเตรียมจ่ายแก้ได้เฉพาะข้อความ', async () => {
    const id = await mk(1);
    await db.query(`select pay_goods_receipt($1,'2026-11-05'::date,null::jsonb)`, [id]);
    expect(await err(upd(id, {}, [{ product_id: a, qty: 2, unit_price: 100 }]))).toContain('รออนุมัติหรืออนุมัติแล้ว');
    await db.query('select reset_goods_receipt($1)', [id]);
    const slip = (await one<any>(`insert into payment_slips(pay_no,pay_date) values ('S1','2026-11-05') returning id`)).id;
    await db.query(`insert into payment_slip_items values ($1,1,'RI',$2)`, [slip, id]);
    await upd(id, { note: 'โน้ตใหม่', project: 'P' }, [{ product_id: a, qty: 9, unit_price: 999 }]);
    const r = await one<any>('select total,note,project from goods_receipts where id=$1', [id]);
    expect([+r.total, r.note, r.project]).toEqual([107, 'โน้ตใหม่', 'P']);
  });
  it('RI แบ่งจาก PO ตามจำนวน: แก้จำนวนได้ไม่เกินคงเหลือ · ราคา/สินค้าล็อกตาม PO', async () => {
    po = (await one<any>('select save_purchase_order(null,$1::jsonb,$2::jsonb) id', [J({ date: '2026-10-01', contact: sup }),
      J([{ product_id: a, qty: 3, unit_price: 100 }])])).id;
    await db.query('select approve_purchase_order($1)', [po]);
    const id = (await one<any>('select split_ri_from_po_qty($1,$2::date,$3::jsonb) id', [po, '2026-11-04', J([{ line_no: 1, qty: 2 }])])).id;
    const before = await onHand(a);
    expect(await err(upd(id, {}, [{ line_no: 1, qty: 4, unit_price: 100 }]))).toContain('เหลือจำนวนที่แบ่งได้ 3 ชิ้น');
    expect(await err(upd(id, {}, [{ line_no: 1, qty: 4, unit_price: 100 }]))).toContain('เหลือจำนวนที่แบ่งได้ 3 ชิ้น');
    await upd(id, {}, [{ line_no: 1, qty: 1, unit_price: 5, product_id: a }]);   // ราคาที่ส่งมาถูกเมินเป็นราคา PO
    const r = await one<any>('select total from goods_receipts where id=$1', [id]);
    expect(+r.total).toBe(107);
    expect(await onHand(a)).toBe(before - 1);
    expect(await err(upd(id, {}, [{ line_no: 2, qty: 1 }]))).toContain('เพิ่มบรรทัดใหม่ไม่ได้');
    expect(+(await one<any>('select po_line_billed_qty($1,1) v', [po])).v).toBe(1);
  });
  it('RI แปลงจาก PO เต็มจำนวน: แก้จำนวน/ราคาได้อิสระ (ตาม FA) · ยังผูก PO เดิม', async () => {
    const p2 = (await one<any>('select save_purchase_order(null,$1::jsonb,$2::jsonb) id', [J({ date: '2026-10-02', contact: sup }),
      J([{ product_id: a, qty: 4, unit_price: 100 }])])).id;
    await db.query('select approve_purchase_order($1)', [p2]);
    const id = (await one<any>('select upgrade_po_to_ri($1,$2::date) id', [p2, '2026-11-04'])).id;
    await upd(id, {}, [{ product_id: a, qty: 3, unit_price: 120 }]);
    const r = await one<any>('select total, po_id from goods_receipts where id=$1', [id]);
    expect([+r.total, r.po_id]).toEqual([385.2, p2]);
  });
});
