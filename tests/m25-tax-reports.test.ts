import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { related } from '../web/lib/related';
import { salesTaxRows, totals, filingInfo, whtRows } from '../web/lib/tax-report';

const dir = new URL('../supabase/migrations/', import.meta.url);
let db: PGlite, cust: string;
const q = async <T = any>(s: string, a: unknown[] = []) => (await db.query<any>(s, a)).rows as T[];
const ACC: [string, string, string][] = [['11112', 'เงินสด', 'asset'], ['11311', 'ลูกหนี้', 'asset'], ['11319', 'รอเก็บ', 'asset'], ['17120', 'ภาษีถูกหัก', 'asset'],
  ['27111', 'ภาษีขาย', 'liability'], ['41110', 'รายได้', 'revenue'], ['41210', 'รายได้บริการ', 'revenue'], ['41400', 'ส่วนลด', 'revenue'], ['21921', 'มัดจำรับ', 'liability']];
const svc = (p: number) => [{ description: 'บริการ', kind: 'service', qty: 1, unit_price: p }];
const mk = async (type: string, date: string, p: number, ref: string | null = null) =>
  (await q<{ id: string }>(`select create_sales_doc($1,$2::date,$3,$4::jsonb,'exclusive',7,$5,$6) id`, [type, date, cust, JSON.stringify(svc(p)), ref, type === 'CN' || type === 'DN' ? 'ทดสอบ' : null]))[0].id;

beforeAll(async () => { db = new PGlite(); for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(new URL(f, dir), 'utf8')); });
beforeEach(async () => {
  await db.exec(`truncate sales_doc_lines, sales_docs, contacts, journal_lines, journal_vouchers, period_locks, doc_sequences, accounts, pp30_filings cascade`);
  for (const [c, n, t] of ACC) await q('insert into accounts(code,name,type) values ($1,$2,$3)', [c, n, t]);
  cust = (await q<{ id: string }>(`insert into contacts(business_name, tax_id) values ('ลูกค้าภาษี','1234567890123') returning id`))[0].id;
});
const sdb = { q: async <T = any>(s: string, a?: unknown[]) => q<T>(s, a as unknown[]) };

describe('M25.2 รายงานภาษีขายตามเอกสาร', () => {
  it('INV+CN(ลบ)+DN รวมยอด · ใบยกเลิกแสดงเมื่อขอแต่ไม่นับยอด · เรียง CA→INV→DN→CN', async () => {
    const i1 = await mk('INV', '2026-10-10', 1000), i2 = await mk('INV', '2026-10-11', 500);
    await mk('CN', '2026-10-12', 100, i1); await mk('DN', '2026-10-12', 50, i1);
    await q(`select cancel_sales_doc($1)`, [i2]);
    const r = ['2026-10-01', '2026-10-31'] as [string, string];
    const live = await salesTaxRows(sdb, r, [], false);
    expect(live.map(x => x.type)).toEqual(['INV', 'DN', 'CN']);
    expect(totals(live)).toEqual({ sub: 950, vat: 66.5 });
    const all = await salesTaxRows(sdb, r, [], true);
    expect(all).toHaveLength(4);
    expect(totals(all)).toEqual({ sub: 950, vat: 66.5 });          // ใบยกเลิกไม่นับ
    expect(live.find(x => x.type === 'CN')!.sub).toBe(-100);
    expect(live.find(x => x.type === 'INV')!.rel.map(x => x.no).length).toBe(2);   // CN + DN ที่อ้างถึง
    expect(live[0].tax_id).toBe('1234567890123'); expect(live[0].branch).toBe('สำนักงานใหญ่');
  });
  it('รอบยื่นภาษี: ยังไม่ยื่น=ยื่นปกติ · ยื่นแล้ว · เอกสารสร้างหลังยื่น=ยื่นเพิ่มเติม-1', async () => {
    const f = await filingInfo(sdb);
    expect(f('2026-10-05', new Date())).toEqual({ status: 'รอยื่นแบบภาษี', round: '10-2026 (ยื่นปกติ)' });
    await q(`insert into pp30_filings(period_month, output_vat, input_vat, result, amount, created_at) values ('2026-10-01',70,0,'payable',70,'2026-10-31T10:00:00Z')`);
    const g = await filingInfo(sdb);
    expect(g('2026-10-05', '2026-10-22T00:00:00Z')).toEqual({ status: 'ยื่นแบบภาษีแล้ว', round: '10-2026 (ยื่นปกติ)' });
    expect(g('2026-10-05', '2026-11-02T00:00:00Z')).toEqual({ status: 'รอยื่นแบบภาษี', round: '10-2026 (ยื่นเพิ่มเติม-1)' });
  });
  it('รายงานหัก ณ ที่จ่ายว่างเมื่อไม่มีใบ', async () => {
    expect(await whtRows(sdb, null, [])).toEqual([]);
  });
});

describe('M25.4 เอกสารที่เกี่ยวข้อง (hover popover)', () => {
  it('INV ได้ทั้ง CN/DN ที่ออกต่อ · CN เห็นต้นทาง INV · เอกสารที่ไม่มีความเกี่ยวข้อง = ไม่มีรายการ', async () => {
    const i1 = await mk('INV', '2026-10-10', 1000), lone = await mk('INV', '2026-10-10', 10);
    const cn = await mk('CN', '2026-10-12', 100, i1), dn = await mk('DN', '2026-10-12', 50, i1);
    const m = await related(sdb, 'sales', [i1, cn, dn, lone]);
    expect(m.get(i1)!.map(x => x.kind).sort()).toEqual(['CN', 'DN']);
    expect(m.get(cn)!.map(x => x.kind)).toEqual(['INV']);
    expect(m.get(dn)!.map(x => x.kind)).toEqual(['INV']);
    expect(m.has(lone)).toBe(false);
    expect(m.get(i1)![0].href).toMatch(/^\/sales\//);
    expect((await related(sdb, 'sales', [])).size).toBe(0);
  });
});
