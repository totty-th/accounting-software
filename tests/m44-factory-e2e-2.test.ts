import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { COA } from '../web/lib/seed';

// โรงงานตะแกรงเหล็ก รอบ 2: หลายคลัง/โอนสต็อก · PO แบ่งรับ · เสนอราคาแบ่งเรียกเก็บ+มัดจำ · DN · สต็อกต่ำ · ภ.พ.30 · งบ · ล็อกงวด
const dir = new URL('../supabase/migrations/', import.meta.url);
let db: PGlite;
const one = async <T = any>(q: string, a: unknown[] = []) => (await db.query<any>(q, a)).rows[0] as T;
const rows = async (q: string, a: unknown[] = []) => (await db.query<any>(q, a)).rows;
const J = JSON.stringify;
const err = async (p: Promise<unknown>) => { try { await p; return ''; } catch (e) { return (e as Error).message; } };
const onHand = async (p: string, w: string | null = null) => +(await one<any>('select stock_on_hand($1,$2) v', [p, w])).v;
const gl = async (code: string) => +(await one<any>(`select coalesce(sum(l.debit-l.credit),0) b from journal_lines l join accounts a on a.id=l.account_id where a.code=$1`, [code])).b;
const S: Record<string, string> = {}; const P: Record<string, string> = {};
const D1 = '2026-10-03', D2 = '2026-10-08', D3 = '2026-10-14', D4 = '2026-10-22';

beforeAll(async () => {
  db = new PGlite();
  for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(new URL(f, dir), 'utf8'));
  for (const [c, n, t] of COA) await db.query('insert into accounts(code,name,type) values ($1,$2,$3) on conflict (code) do update set name=excluded.name,type=excluded.type,is_control=false', [c, n, t]);
  await db.query(`insert into accounts(code,name,type) values ('11125','ธนาคาร','asset')`);
  S.sup = (await one<any>(`insert into contacts(business_name,tax_id) values ('บริษัท เหล็กแผ่นไทย จำกัด','0105511111111') returning id`)).id;
  S.cu = (await one<any>(`insert into contacts(business_name,tax_id,credit_days) values ('บริษัท ก่อสร้างมั่นคง จำกัด','0105533333333',30) returning id`)).id;
  S.main = (await one<any>('select main_warehouse() id')).id;
  S.br = (await one<any>(`select create_warehouse('BR1','คลังสาขาระยอง','branch') id`)).id;
  S.bank = (await one<any>(`insert into bank_accounts(account_id,bank_name,account_no) values ((select id from accounts where code='11125'),'ธนาคารทดสอบ','1') returning id`)).id;
  const mk = async (c: string, n: string, k: string, sale: number, buy: number, block = false) =>
    (P[c] = (await one<any>(`insert into products(code,name,kind,sale_price,purchase_price,base_unit,block_negative) values ($1,$2,$3,$4,$5,'แผ่น',$6) returning id`, [c, n, k, sale, buy, block])).id);
  await mk('RM-1', 'เหล็กแผ่น SS400 1.5 มม.', 'goods_stock', 0, 1200);
  await mk('FG-A', 'ตะแกรงฉีก SS400 1.5 มม.', 'goods_stock', 850, 550, true);
  await mk('FG-B', 'ตะแกรงเจาะรู สแตนเลส 2.0 มม.', 'goods_stock', 3400, 2800, true);
  await mk('SV-1', 'ค่าขนส่ง', 'service', 500, 0);
  await db.query('select set_opening_stock($1,$2::date,$3,$4)', [P['FG-A'], '2026-10-01', 200, 550]);
  await db.query('select set_opening_stock($1,$2::date,$3,$4)', [P['FG-B'], '2026-10-01', 30, 2800]);
});

describe('คลังหลายแห่ง/โอนสต็อก', () => {
  it('โอน MAIN→สาขา: ยังไม่รับ = ไม่เคลื่อนไหว · รับแล้ว = ต้นทางลด ปลายทางเพิ่ม มูลค่ารวมเท่าเดิม', async () => {
    const v0 = +(await one<any>('select sum(value) v from product_stock')).v;
    const t = (await one<any>('select create_transfer($1::date,$2,$3,$4::jsonb) id', [D1, S.main, S.br, J([{ product_id: P['FG-A'], qty: 60 }, { product_id: P['FG-B'], qty: 10 }])])).id;
    expect(await onHand(P['FG-A'], S.br)).toBe(0);
    await db.query('select receive_transfer($1,$2::date)', [t, D1]);
    expect(await onHand(P['FG-A'], S.main)).toBe(140); expect(await onHand(P['FG-A'], S.br)).toBe(60);
    expect(await onHand(P['FG-A'])).toBe(200);
    expect(+(await one<any>('select sum(value) v from product_stock')).v).toBe(v0);
    S.tf = t;
  });
  it('บล็อกติดลบ: โอนเกินคงเหลือต้นทางไม่ได้', async () => {
    const t = (await one<any>('select create_transfer($1::date,$2,$3,$4::jsonb) id', [D1, S.br, S.main, J([{ product_id: P['FG-B'], qty: 11 }])])).id;
    expect(await err(db.query('select receive_transfer($1,$2::date)', [t, D1]))).toContain('สต็อกต้นทางไม่พอ');
  });
  it('ขายจากคลังสาขา (ระบุคลังที่บรรทัด) ตัดเฉพาะคลังสาขา', async () => {
    const inv = (await one<any>('select create_invoice_full($1::jsonb,$2::jsonb) id', [J({ date: D2, contact: S.cu }), J([{ product_id: P['FG-A'], qty: 25, unit_price: 850, warehouse_id: S.br }])])).id;
    expect(await onHand(P['FG-A'], S.br)).toBe(35); expect(await onHand(P['FG-A'], S.main)).toBe(140);
    expect(inv).toBeTruthy();
  });
  it('ขายเกินคงเหลือคลังสาขา (บล็อกติดลบ) ไม่ได้', async () => {
    expect(await err(db.query('select create_invoice_full($1::jsonb,$2::jsonb)', [J({ date: D2, contact: S.cu }), J([{ product_id: P['FG-A'], qty: 36, unit_price: 850, warehouse_id: S.br }])]))).not.toBe('');
  });
  it('รายงานสต็อกคงเหลือแยกคลังและรวม ตรงกับการ์ดสต็อก', async () => {
    const all = await rows(`select * from inventory_summary('2026-10-31')`);
    const a = all.find((r: any) => r.code === 'FG-A');
    expect(+a.qty).toBe(175);
    const br = await rows(`select * from inventory_summary('2026-10-31',$1)`, [S.br]);
    expect(+br.find((r: any) => r.code === 'FG-A').qty).toBe(35);
  });
});

describe('ซื้อ: PO แบ่งรับ', () => {
  it('PO 100 แผ่น → แบ่งรับ 40% เข้าสต็อก → รับส่วนที่เหลือ → ยอดรวมตรง PO', async () => {
    const po = (await one<any>('select save_purchase_order(null,$1::jsonb,$2::jsonb) id', [J({ date: D2, contact: S.sup, credit_days: 30 }), J([{ product_id: P['RM-1'], qty: 100, unit_price: 1200 }])])).id;
    await db.query('select approve_purchase_order($1)', [po]);
    const r1 = (await one<any>('select split_ri_from_po($1,$2::date,$3,$4,true) id', [po, D2, 'percent', 40])).id;
    // ตามต้นแบบ: ติ๊ก "รับเข้าสต็อก" = รับจำนวนทั้งใบสั่งซื้อครั้งเดียว (แบ่งเฉพาะยอดเงิน) · รับซ้ำไม่ได้
    expect(await onHand(P['RM-1'])).toBe(100);
    expect(await err(db.query('select split_ri_from_po($1,$2::date,$3,$4,true)', [po, D3, 'percent', 10]))).toContain('รับเข้าสต็อกไปแล้ว');
    const r2 = (await one<any>('select split_ri_from_po($1,$2::date,$3,$4) id', [po, D3, 'percent', 60])).id;
    expect(await onHand(P['RM-1'])).toBe(100);
    const tot = +(await one<any>('select sum(total) t from goods_receipts where id in ($1,$2)', [r1, r2])).t;
    expect(tot).toBe(128400);
    expect(+(await one<any>('select po_billed($1) b', [po])).b).toBe(128400);
    expect(await gl('21311')).toBe(-128400);
  });
});

describe('ขาย: เสนอราคา แบ่งเรียกเก็บ/มัดจำ/ใบเพิ่มหนี้', () => {
  it('QT 100 แผ่น → มัดจำ 30% → รับมัดจำ → ใบแจ้งหนี้ส่วนที่เหลือหักมัดจำ', async () => {
    S.qt = (await one<any>('select save_quotation(null,$1::jsonb,$2::jsonb) id', [J({ date: D3, contact: S.cu, credit_days: 30 }), J([{ product_id: P['FG-A'], qty: 100, unit_price: 850 }])])).id;
    await db.query('select approve_quotation($1)', [S.qt]);
    const dep = (await one<any>('select create_deposit_invoice($1,$2::date,$3) id', [S.qt, D3, 25500])).id;   // มัดจำ 30% ก่อน VAT
    const d = await one<any>('select total, doc_type, status from sales_docs where id=$1', [dep]);
    expect(+d.total).toBe(27285);
    const r = (await one<any>('select create_receipt_from_invoice($1,$2::date) id', [dep, D3])).id;
    await db.query('select collect_receipt($1,$2::date,$3::jsonb)', [r, D3, J([{ method: 'transfer', amount: 27285, bank_account_id: S.bank }])]);
    expect(await gl('21921')).toBe(-25500);                      // มัดจำรับ (เครดิต)
    expect(await onHand(P['FG-A'])).toBe(175);                  // มัดจำไม่ตัดสต็อก
    expect((await one<any>('select status from sales_docs where id=$1', [S.qt])).status).toBe('deposit_paid');
    const inv = (await one<any>('select create_final_invoice($1,$2::date) id', [S.qt, D4])).id;
    const f = await one<any>('select subtotal, vat, total, deposit_net from sales_docs where id=$1', [inv]);
    expect(+f.subtotal).toBe(85000); expect(+f.deposit_net).toBe(25500); expect(+f.total).toBe(85000 + 5950 - 27285);
    expect(await onHand(P['FG-A'])).toBe(75);
    S.inv = inv; S.dep = dep;
  });
  it('ใบเพิ่มหนี้ DN "ตัดสต็อก" บรรทัดค่าขนส่งไม่แตะสต็อก', async () => {
    const dn = (await one<any>('select create_sales_doc($1,$2::date,$3,$4::jsonb,$5,7,$6,$7) id', ['DN', D4, S.cu,
      J([{ description: 'ตะแกรงเพิ่ม 3', product_id: P['FG-A'], qty: 3, unit_price: 850, stock_action: 'cut' }, { description: 'ค่าขนส่งเพิ่ม', product_id: P['SV-1'], qty: 1, unit_price: 500 }]), 'exclusive', S.inv, 'ส่งเพิ่ม'])).id;
    expect(+(await one<any>('select total t from sales_docs where id=$1', [dn])).t).toBe(3050 * 1.07);
    expect(await onHand(P['FG-A'])).toBe(72);
  });
});

describe('สต็อกต่ำ', () => {
  it('ตั้งจุดสั่งซื้อซ้ำ แล้วรายการแจ้งเตือนขึ้นเมื่อต่ำกว่า', async () => {
    await db.query(`select set_product_low_stock($1,'custom',$2::jsonb)`, [P['FG-B'], J([{ warehouse_id: S.main, min_qty: 25 }, { warehouse_id: S.br, min_qty: 5 }])]);
    const low = await rows('select * from low_stock_items()');                  // main 20 ≤ 25 → เตือน · br 10 > 5 → ไม่เตือน
    expect(low.length).toBe(1); expect(J(low[0])).toContain('FG-B');

  });
});

describe('ภาษี/งบ/ล็อกงวด', () => {
  it('ภ.พ.30 เดือนตุลาคม: ภาษีขาย − ภาษีซื้อ ตรงบัญชี', async () => {
    const out = -(await gl('27111')); const inn = await gl('17113');
    const id = (await one<any>(`select file_pp30('2026-10-01') id`)).id;
    const f = await one<any>('select * from pp30_filings where id=$1', [id]);
    expect(+f.output_vat).toBe(out); expect(+f.input_vat).toBe(inn);
    expect(+f.amount).toBeCloseTo(Math.abs(out - inn), 2);
    expect(await gl('27111')).toBe(0);
  });
  it('งบฐานะการเงินสมดุล สินทรัพย์ = หนี้สิน + ส่วนของเจ้าของ', async () => {
    const bs = await rows(`select * from balance_sheet('2026-10-31')`);
    const sum = (s: string) => bs.filter((r: any) => r.section === s).reduce((a: number, r: any) => a + Number(r.amount), 0);
    expect(sum('asset')).toBeCloseTo(sum('liability') + sum('equity'), 2);
  });
  it('งบกำไรขาดทุน: รายได้ขาย = ยอดก่อน VAT ของ INV/DN (มัดจำไม่นับเป็นรายได้ซ้ำ)', async () => {
    const is = await rows(`select * from income_statement('2026-10-01','2026-10-31')`);
    const rev = is.filter((r: any) => r.section === 'revenue').reduce((a: number, r: any) => a + Number(r.amount), 0);
    expect(rev).toBe(21250 + 85000 + 3050);   // INV 25 แผ่น + INV 100 แผ่น (หักมัดจำแล้วรายได้เต็ม) + DN
  });
  it('ล็อกงวดตุลาคม: ออกเอกสารย้อนหลังในงวดที่ล็อกไม่ได้', async () => {
    await db.query(`select lock_period('2026-10-01','2026-10-31','ปิดงวดทดสอบ')`);
    const e = await err(db.query('select create_invoice_full($1::jsonb,$2::jsonb)', [J({ date: '2026-10-30', contact: S.cu }), J([{ product_id: P['SV-1'], qty: 1, unit_price: 500 }])]));
    expect(e).toContain('ล็อก');
  });
});
