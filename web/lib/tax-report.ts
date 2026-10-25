// ข้อมูลรายงานภาษี 3 ฉบับ (ภาษีขายตามเอกสาร / ภาษีซื้อ / หัก ณ ที่จ่าย) ใช้ร่วมกันระหว่างหน้าจอและไฟล์ Excel แบบ FA
import { pgArr } from './report-filter';
type Db = { q: <T = any>(sql: string, a?: unknown[]) => Promise<T[]> };

export const SALES_TAX_TYPES = ['CA', 'INV', 'DN', 'CN'];
const TYPE_ORDER = `case d.doc_type when 'CA' then 1 when 'INV' then 2 when 'DN' then 3 else 4 end`;
export const branchLabel = (c: { is_cash_default?: boolean; branch_code?: string | null }) =>
  c.is_cash_default ? '' : c.branch_code ? `สาขา ${c.branch_code}` : 'สำนักงานใหญ่';

/** รอบยื่น ภ.พ.30 ของเดือนภาษี (ใช้ทั้งภาษีขายและภาษีซื้อ): ยื่นเดือนนั้นครั้งแรก = ยื่นปกติ, ครั้งถัดไป (หลังลบแบบเดิม) = ยื่นเพิ่มเติม-N
 *  เอกสารที่สร้างหลังวันที่ยื่น → "รอยื่นแบบภาษี" รอบถัดไป (สมมติฐานตามไฟล์ FA ที่เห็น — ยังไม่ทดสอบกรณีซับซ้อน) */
export async function filingInfo(db: Db) {
  const f = await db.q<any>(`select period_month, status, created_at from pp30_filings order by period_month, created_at`);
  const byMonth = new Map<string, any[]>();
  for (const x of f) { const k = String(x.period_month instanceof Date ? x.period_month.toISOString() : x.period_month).slice(0, 7); byMonth.set(k, [...(byMonth.get(k) ?? []), x]); }
  const roundName = (n: number) => (n === 0 ? 'ยื่นปกติ' : `ยื่นเพิ่มเติม-${n}`);
  return (dateIso: string, createdAt: Date | string) => {
    const k = dateIso.slice(0, 7), list = byMonth.get(k) ?? [], lab = `${k.slice(5, 7)}-${k.slice(0, 4)}`;
    const idx = list.findIndex(x => x.status === 'filed');
    if (idx >= 0 && new Date(createdAt) <= new Date(list[idx].created_at)) return { status: 'ยื่นแบบภาษีแล้ว', round: `${lab} (${roundName(idx)})` };
    return { status: 'รอยื่นแบบภาษี', round: `${lab} (${roundName(list.length)})` };
  };
}

export type SalesTaxRow = { id: string; no: string; type: string; date: string; status: string; name: string; tax_id: string | null; branch: string;
  ref_no: string | null; sub: number; vat: number; created_at: any; deposit: boolean; rel: { no: string; kind: string; href: string }[] };

export async function salesTaxRows(db: Db, range: [string, string] | null, statuses: string[], withCancel: boolean): Promise<SalesTaxRow[]> {
  const rows = await db.q<any>(`select d.id, d.doc_no no, d.doc_type type, d.doc_date date, d.status, d.created_at, d.is_deposit deposit,
      coalesce(c.business_name, c.contact_name, '-') name, c.tax_id, c.branch_code, c.is_cash_default, ref.doc_no ref_no,
      d.subtotal * (case when d.doc_type = 'CN' then -1 else 1 end) sub, d.vat * (case when d.doc_type = 'CN' then -1 else 1 end) vat
    from sales_docs d join contacts c on c.id = d.contact_id left join sales_docs ref on ref.id = d.ref_doc_id
    where d.doc_type = any($4::text[]) and ($1::date is null or d.doc_date >= $1::date) and ($2::date is null or d.doc_date <= $2::date)
      and ${withCancel ? 'true' : `d.status <> 'cancelled'`} and (cardinality($3::text[]) = 0 or d.status = any($3::text[]))
    order by ${TYPE_ORDER}, d.doc_no`, [range?.[0] ?? null, range?.[1] ?? null, pgArr(statuses), pgArr(SALES_TAX_TYPES)]);
  const rel = rows.length ? await db.q<any>(`select x.id, x.no, x.kind, x.href from (
      select d.id, r.doc_no no, r.doc_type kind, '/sales/' || r.doc_no href from sales_docs d join sales_docs r on r.id = d.ref_doc_id
      union all select d.id, ch.doc_no, ch.doc_type, '/sales/' || ch.doc_no from sales_docs d join sales_docs ch on ch.ref_doc_id = d.id
      union all select ri.doc_id, rc.receipt_no, 'RE', '/receipts/' || rc.receipt_no from receipt_items ri join receipts rc on rc.id = ri.receipt_id where rc.status <> 'cancelled'
      union all select b.invoice_id, bl.doc_no, 'BL', '/sales/' || bl.doc_no from billing_note_items b join sales_docs bl on bl.id = b.billing_id where bl.status <> 'cancelled') x
    where x.id = any($1::uuid[]) order by x.no`, [`{${rows.map(r => r.id).join(',')}}`]) : [];
  const m = new Map<string, any[]>();
  for (const r of rel) { const l = m.get(r.id) ?? []; if (!l.some(y => y.no === r.no)) l.push(r); m.set(r.id, l); }
  return rows.map(r => ({ ...r, branch: branchLabel(r), sub: Number(r.sub), vat: Number(r.vat), rel: m.get(r.id) ?? [] }));
}
export const totals = (rows: { status: string; sub: number; vat: number }[]) =>
  rows.filter(r => r.status !== 'cancelled').reduce((a, r) => ({ sub: a.sub + r.sub, vat: a.vat + r.vat }), { sub: 0, vat: 0 });

// ---------- ภาษีซื้อตามเอกสาร (RI / EXP ที่มี VAT) ----------
export type PurchaseTaxRow = { id: string; no: string; kind: 'RI' | 'EXP'; date: string; status: string; ref_no: string | null; name: string; tax_id: string | null;
  inv_no: string | null; vat_form: string | null; inv_date: string | null; branch: string; sub: number; vat: number; created_at: any; href: string; rel: { no: string; kind: string; href: string }[] };

export async function purchaseTaxRows(db: Db, range: [string, string] | null, statuses: string[], withCancel: boolean): Promise<PurchaseTaxRow[]> {
  const rows = await db.q<any>(`select d.*, coalesce(c.business_name, c.contact_name, '-') name, coalesce(t.vendor_tax_id, c.tax_id) tax_id, c.branch_code, c.is_cash_default,
      t.invoice_no inv_no, t.vat_form, t.invoice_date inv_date from (
        select 'RI' kind, g.id, g.ri_no no, g.ri_date date, g.contact_id, g.status, g.subtotal sub, g.vat, g.created_at, (select po.po_no from purchase_orders po where po.id = g.po_id) ref_no from goods_receipts g
        union all select 'EXP', e.id, e.exp_no, e.exp_date, e.contact_id, e.status, e.subtotal, e.vat, e.created_at, null from expenses e) d
      join contacts c on c.id = d.contact_id left join purchase_tax_invoices t on t.doc_type = d.kind and t.doc_id = d.id
    where d.vat > 0 and ($1::date is null or d.date >= $1::date) and ($2::date is null or d.date <= $2::date)
      and ${withCancel ? 'true' : `d.status not in ('rejected','cancelled')`} and (cardinality($3::text[]) = 0 or d.status = any($3::text[]))
    order by d.kind desc, d.no`, [range?.[0] ?? null, range?.[1] ?? null, pgArr(statuses)]);
  const ids = `{${rows.map(r => r.id).join(',')}}`;
  const rel = rows.length ? await db.q<any>(`select x.id, x.no, x.kind, x.href from (
      select w.expense_id id, w.cert_no no, 'WT' kind, '/wht' href from wht_certs w where w.expense_id is not null and w.status = 'active'
      union all select x.doc_id, s.pay_no, 'PAY', '/payments' from payment_slip_items x join payment_slips s on s.id = x.slip_id where s.status = 'active') x
    where x.id = any($1::uuid[]) order by x.no`, [ids]) : [];
  const m = new Map<string, any[]>();
  for (const r of rel) m.set(r.id, [...(m.get(r.id) ?? []), r]);
  return rows.map(r => ({ ...r, branch: branchLabel(r), sub: Number(r.sub), vat: Number(r.vat), rel: m.get(r.id) ?? [],
    href: r.kind === 'EXP' ? `/expenses/${r.id}` : `/purchases/ri/${r.id}` }));
}

// ---------- ภาษีหัก ณ ที่จ่าย ----------
export type WhtRow = { id: string; no: string; date: string; status: string; name: string; tax_id: string | null; address: string | null; branch: string; form: string; income: string;
  base: number; wht: number; exp_no: string | null; exp_id: string | null };
export const WHT_FORM: Record<string, string> = { PND53: 'ภงด 53', PND3: 'ภงด 3', PND1K: 'ภงด 1ก', PND1KS: 'ภงด 1ก (พิเศษ)', PND2: 'ภงด 2', PND2K: 'ภงด 2ก', PND3K: 'ภงด 3ก' };
export const WHT_ST: Record<string, string> = { active: 'ดำเนินการแล้ว', cancelled: 'ยกเลิก' };
export async function whtRows(db: Db, range: [string, string] | null, statuses: string[]): Promise<WhtRow[]> {
  const rows = await db.q<any>(`select w.id, w.cert_no no, w.pay_date date, w.status, coalesce(c.business_name, c.contact_name, '-') name, c.tax_id, c.address, c.branch_code, c.is_cash_default,
      w.form_code, coalesce(w.income_type, '') income, w.base_amount base, w.wht_amount wht, e.exp_no, e.id exp_id
    from wht_certs w join contacts c on c.id = w.contact_id left join expenses e on e.id = w.expense_id
    where ($1::date is null or w.pay_date >= $1::date) and ($2::date is null or w.pay_date <= $2::date) and (cardinality($3::text[]) = 0 or w.status = any($3::text[]))
    order by w.cert_no`, [range?.[0] ?? null, range?.[1] ?? null, pgArr(statuses)]);
  return rows.map(r => ({ ...r, branch: branchLabel(r), form: WHT_FORM[r.form_code] ?? r.form_code, base: Number(r.base), wht: Number(r.wht) }));
}
