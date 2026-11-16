import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { COA } from '../web/lib/seed';

// M58 มุมมองนักบัญชี/ผู้สอบบัญชี: จำลองธุรกิจ 1 เดือน (ทุนจดทะเบียน · ซื้อสินค้า · ขาย · รับ/จ่ายเงิน · ค่าใช้จ่ายหัก ณ ที่จ่าย ·
// สินทรัพย์+ค่าเสื่อม · ยกเลิกเอกสาร) แล้วตรวจแบบที่ผู้สอบบัญชีตรวจ: งบดุลสมดุล · กำไรในงบกำไรขาดทุน = กำไรในงบดุล ·
// สมุดย่อย (สต็อก/ลูกหนี้/เจ้าหนี้/ภาษี) ตรงบัญชีคุม · เลขที่เอกสารต่อเนื่อง · ร่องรอยการแก้ไข · ปิดงวดแล้วบัญชีรายได้/ค่าใช้จ่ายเป็นศูนย์
const dir = new URL('../supabase/migrations/', import.meta.url);
let db: PGlite;
const J = JSON.stringify;
const one = async (q: string, a: unknown[] = []) => (await db.query<any>(q, a)).rows[0];
const rows = async (q: string, a: unknown[] = []) => (await db.query<any>(q, a)).rows;
const gl = async (code: string, asof = '2026-12-31') => +(await one(`select coalesce(sum(l.debit-l.credit),0) b from journal_lines l
  join journal_vouchers v on v.id=l.voucher_id join accounts a on a.id=l.account_id where a.code=$1 and v.voucher_date<=$2`, [code, asof])).b;
const findings: string[] = [];
const note = (s: string) => { findings.push(s); console.log('[พบ]', s); };
let cust = '', sup = '', P = '';

beforeAll(async () => {
  db = new PGlite();
  for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(new URL(f, dir), 'utf8'));
  for (const [c, n, t] of COA) await db.query('insert into accounts(code,name,type) values ($1,$2,$3) on conflict (code) do update set name=excluded.name,type=excluded.type', [c, n, t]);
  await db.query(`insert into accounts(code,name,type) values ('31201','ทุนที่ชำระแล้ว - หุ้นสามัญ','equity') on conflict do nothing`);
  cust = (await one(`insert into contacts(business_name,tax_id,credit_days) values ('ลูกค้า ก','0105500000001',30) returning id`)).id;
  sup = (await one(`insert into contacts(business_name,tax_id,credit_days) values ('ผู้ขาย ข','0105500000002',30) returning id`)).id;
  P = (await one(`insert into products(code,name,kind,sale_price,purchase_price,base_unit) values ('A','ตะแกรง','goods_stock',1000,600,'แผ่น') returning id`)).id;

  // ---- ธุรกรรมเดือนตุลาคม 2026 ----
  await db.query('select create_jv($1::jsonb)', [J({ date: '2026-10-01', memo: 'ทุนจดทะเบียน', lines: [{ account: '11112', debit: 500000 }, { account: '31201', credit: 500000 }] })]);
  const ri = (await one('select save_goods_receipt($1::jsonb,$2::jsonb) id', [J({ date: '2026-10-02', contact: sup, credit_days: 30 }), J([{ product_id: P, qty: 100, unit_price: 600 }])])).id;
  await db.query('select approve_goods_receipt($1)', [ri]).catch(() => {});
  await db.query(`select pay_goods_receipt($1,'2026-10-20'::date)`, [ri]);
  const inv = async (q: number, d: string) => (await one('select create_invoice_full($1::jsonb,$2::jsonb,null,$3) id',
    [J({ date: d, contact: cust }), J([{ description: 'ตะแกรง', product_id: P, qty: q, unit_price: 1000 }]), 'INV'])).id;
  const i1 = await inv(30, '2026-10-05'); const i2 = await inv(20, '2026-10-10'); const i3 = await inv(5, '2026-10-12');
  await db.query('select cancel_sales_doc($1)', [i3]);                       // ลูกค้ายกเลิก
  const r1 = (await one(`select create_receipt_from_invoice($1,'2026-10-25'::date,null) id`, [i1])).id;
  await db.query(`select collect_receipt($1,'2026-10-25'::date,$2::jsonb)`, [r1, J([{ method: 'cash', amount: 32100 }])]);
  const ex = (await one('select save_expense($1::jsonb,$2::jsonb) id', [J({ date: '2026-10-15', contact: sup }),
    J([{ description: 'ค่าเช่าโกดัง', account: '53102', qty: 1, unit_price: 10000, wht_rate: 5 }])])).id;
  await db.query(`select pay_expense($1,'2026-10-15'::date)`, [ex]).catch((e) => note(`จ่ายค่าใช้จ่ายไม่สำเร็จ: ${e.message}`));
});

describe('M58 ตรวจแบบผู้สอบบัญชี (เดือน ต.ค. 2026)', () => {
  it('1 งบทดลองและงบดุลสมดุล (สินทรัพย์ = หนี้สิน + ทุน)', async () => {
    const bs = await rows(`select section, sum(amount)::float8 s from balance_sheet('2026-10-31') group by section`);
    const s = Object.fromEntries(bs.map(x => [x.section, x.s]));
    console.log('[1] งบดุล 31-10-2026:', s);
    expect(Math.abs(s.asset - (s.liability + s.equity))).toBeLessThan(0.005);
  });
  it('2 กำไรสุทธิในงบกำไรขาดทุน = กำไรงวดปัจจุบันในงบดุล', async () => {
    const pl = await rows(`select section, sum(amount)::float8 s from income_statement('2026-10-01','2026-10-31') group by section`);
    const p = Object.fromEntries(pl.map(x => [x.section, x.s]));
    const net = (p.revenue ?? 0) - (p.expense ?? 0);
    const cur = +(await one(`select amount from balance_sheet('2026-10-31') where code=''`)).amount;
    console.log('[2] รายได้', p.revenue, 'ค่าใช้จ่าย', p.expense, 'กำไรสุทธิ', net, '· ในงบดุล', cur);
    expect(Math.abs(net - cur)).toBeLessThan(0.005);
    if (!pl.some(x => x.section === 'expense') || !(await rows(`select 1 from income_statement('2026-10-01','2026-10-31') where code like '51%'`)).length)
      note('งบกำไรขาดทุนไม่มีต้นทุนขาย (ขาย 50 แผ่น ทุน 30,000 ไม่ถูกบันทึก) → กำไรขั้นต้นสูงเกินจริงจนกว่าจะปรับปรุงสินค้าคงเหลือปลายงวดด้วยมือ');
  });
  it('3 สินค้าคงเหลือ: บัญชีคุม 11500 เทียบรายงานสต็อก', async () => {
    const g = await gl('11500', '2026-10-31');
    const s = +(await one(`select coalesce(sum(value),0) v from inventory_summary('2026-10-31')`)).v;
    console.log('[3] GL 11500 =', g, '· มูลค่าสต็อกตามรายงาน =', s);
    if (Math.abs(g - s) > 0.005) note(`สินค้าคงเหลือในบัญชี (${g}) ≠ มูลค่าสต็อกจริง (${s}) ต่างกัน ${g - s} = ต้นทุนของที่ขายไป ซึ่งไม่ได้ลงบัญชี (M12)`);
  });
  it('4 ภาษีขาย/ภาษีซื้อในบัญชีตรงเอกสาร และยื่น ภ.พ.30 ได้', async () => {
    const out = -(await gl('27111', '2026-10-31')); const inp = (await gl('17111', '2026-10-31')) + (await gl('17113', '2026-10-31'));
    console.log('[4] ภาษีขาย', out, '· ภาษีซื้อ', inp);
    expect(out).toBe(3500);                                                  // (30+20) × 1,000 × 7%
    const e = await db.query(`select file_pp30('2026-10-01'::date)`).then(() => '').catch((x) => x.message);
    console.log('[4] ยื่น ภ.พ.30:', e || 'สำเร็จ');
    if (e) note(`ยื่น ภ.พ.30 เดือน ต.ค. ไม่สำเร็จ: ${e}`);
  });
  it('5 หัก ณ ที่จ่ายค่าเช่า 5% มีหนังสือรับรอง/ภาษีค้างนำส่ง', async () => {
    const w = await gl('21330', '2026-10-31').catch(() => 0);
    const certs = +(await one(`select count(*) c from wht_certs`)).c;
    console.log('[5] ภาษีหัก ณ ที่จ่ายค้างนำส่ง (21330):', -w, '· หนังสือรับรอง 50 ทวิ:', certs);
    if (certs === 0) note('จ่ายค่าเช่าหัก ณ ที่จ่ายแล้วไม่มีหนังสือรับรอง 50 ทวิ ถูกสร้าง (ตรวจว่าต้องกดออกเองหรือไม่)');
  });
  it('6 เลขที่เอกสารต่อเนื่อง ไม่มีเลขหาย (ใบที่ยกเลิกยังอยู่)', async () => {
    const d = await rows(`select doc_no, status from sales_docs where doc_type='INV' order by doc_no`);
    console.log('[6] INV:', d.map(x => `${x.doc_no}${x.status === 'cancelled' ? '(ยกเลิก)' : ''}`).join(', '));
    expect(d.length).toBe(3);
    const v = await rows(`select voucher_no from journal_vouchers order by voucher_no`);
    const noCreator = +(await one(`select count(*) c from journal_vouchers where created_by is null`)).c;
    console.log('[6] ใบสำคัญ', v.length, 'ใบ · ไม่มีผู้บันทึก', noCreator);
    // ในเทสต์ไม่มีผู้ล็อกอิน จึงไม่มีผู้บันทึก — บนเว็บทริกเกอร์ 0038 ใส่ผู้ใช้จาก session ให้ทุกใบ
  });
  it('7 ใบสำคัญที่ลงแล้วแก้/ลบตรง ๆ ไม่ได้', async () => {
    const e1 = await db.query(`update journal_lines set debit=debit+1 where id=(select id from journal_lines limit 1)`).then(() => '').catch(x => x.message);
    const e2 = await db.query(`delete from journal_vouchers where id=(select id from journal_vouchers limit 1)`).then(() => '').catch(x => x.message);
    console.log('[7] แก้บรรทัด:', e1 || 'ทำได้!', '· ลบใบสำคัญ:', e2 || 'ทำได้!');
    expect(e1).not.toBe(''); expect(e2).not.toBe('');
  });
  it('8 ร่องรอยการแก้ไขเอกสารฝั่งซื้อ (RI/EXP) มีประวัติเหมือนฝั่งขายหรือไม่', async () => {
    const t = await rows(`select table_name from information_schema.tables where table_name ~ '(event|history|audit|edit)'`);
    console.log('[8] ตารางประวัติ:', t.map(x => x.table_name).join(', '));
    if (!t.some(x => /goods_receipt|purchase|expense/.test(x.table_name))) note('ไม่มีตารางประวัติการแก้ไข/เปลี่ยนสถานะของเอกสารซื้อ (RI/EXP/PO) — ฝั่งขายมี doc_events');
  });
  it('9 ปิดงวดสิ้นปี: รายได้/ค่าใช้จ่ายเป็นศูนย์ โอนเข้ากำไรสะสม และงบดุลยังสมดุล', async () => {
    const e = await db.query(`select create_period_closing('2026-12-31','2026-01-01','2026-12-31',null,true)`).then(() => '').catch(x => x.message);
    console.log('[9] ปิดงวด:', e || 'สำเร็จ');
    if (e) { note(`ปิดงวดสิ้นปีไม่สำเร็จ: ${e}`); return; }
    const left = await one(`select coalesce(sum(l.debit-l.credit),0)::float8 s from journal_lines l join accounts a on a.id=l.account_id where a.type in ('revenue','expense')`);
    const bs = await rows(`select section, sum(amount)::float8 s from balance_sheet('2026-12-31') group by section`);
    console.log('[9] คงเหลือรายได้/ค่าใช้จ่าย', left.s, '· งบดุลหลังปิด', Object.fromEntries(bs.map(x => [x.section, x.s])));
    expect(Math.abs(left.s)).toBeLessThan(0.005);
    const e2 = await db.query('select create_invoice_full($1::jsonb,$2::jsonb,null,$3)', [J({ date: '2026-11-01', contact: cust }), J([{ description: 'x', qty: 1, unit_price: 1 }]), 'INV']).then(() => '').catch(x => x.message);
    console.log('[9] ออกเอกสารในปีที่ปิดแล้ว:', e2 || 'ทำได้');
    if (!e2) note('ปิดงวดสิ้นปีแล้วยังออกเอกสารย้อนหลังในปีนั้นได้ ถ้าไม่ได้ตั้งล็อกงวดแยก (ต้องล็อกงวดทุกครั้งหลังปิด)');
  });
  it('สรุปข้อสังเกต', () => { console.log('\n===== ข้อสังเกตผู้สอบบัญชี =====\n' + findings.map((f, i) => `${i + 1}. ${f}`).join('\n')); });
});
