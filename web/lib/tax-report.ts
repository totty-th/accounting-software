// ข้อมูลรายงานภาษี 3 ฉบับ (ภาษีขายตามเอกสาร / ภาษีซื้อ / หัก ณ ที่จ่าย) ใช้ร่วมกันระหว่างหน้าจอและไฟล์ Excel แบบ FA
import { pgArr } from './report-filter';
import { related } from './related';
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
  ref_no: string | null; project: string | null; sub: number; vat: number; created_at: any; deposit: boolean; rel: { no: string; kind: string; href: string }[] };

export async function salesTaxRows(db: Db, range: [string, string] | null, statuses: string[], withCancel: boolean): Promise<SalesTaxRow[]> {
  const rows = await db.q<any>(`select d.id, d.doc_no no, d.doc_type type, d.doc_date date, d.status, d.created_at, d.is_deposit deposit,
      coalesce(c.business_name, c.contact_name, '-') name, c.tax_id, c.branch_code, c.is_cash_default, ref.doc_no ref_no, d.project,
      d.subtotal * (case when d.doc_type = 'CN' then -1 else 1 end) sub, d.vat * (case when d.doc_type = 'CN' then -1 else 1 end) vat
    from sales_docs d join contacts c on c.id = d.contact_id left join sales_docs ref on ref.id = d.ref_doc_id
    where d.doc_type = any($4::text[]) and ($1::date is null or d.doc_date >= $1::date) and ($2::date is null or d.doc_date <= $2::date)
      and ${withCancel ? 'true' : `d.status <> 'cancelled'`} and (cardinality($3::text[]) = 0 or d.status = any($3::text[]))
    order by ${TYPE_ORDER}, d.doc_no desc`, [range?.[0] ?? null, range?.[1] ?? null, pgArr(statuses), pgArr(SALES_TAX_TYPES)]);
  const m = await related(db, 'sales', rows.map(r => r.id));
  return rows.map(r => ({ ...r, branch: branchLabel(r), sub: Number(r.sub), vat: Number(r.vat), rel: m.get(r.id) ?? [] }));
}
export const totals = (rows: { status: string; sub: number; vat: number }[]) =>
  rows.filter(r => r.status !== 'cancelled').reduce((a, r) => ({ sub: a.sub + r.sub, vat: a.vat + r.vat }), { sub: 0, vat: 0 });

// ---------- ภาษีซื้อตามเอกสาร (RI / EXP ที่มี VAT) ----------
export type PurchaseTaxRow = { id: string; no: string; kind: 'RI' | 'EXP'; date: string; status: string; ref_no: string | null; name: string; tax_id: string | null;
  inv_no: string | null; vat_form: string | null; inv_date: string | null; inv_base: number | null; inv_vat: number | null; branch: string; sub: number; vat: number; created_at: any; href: string; rel: { no: string; kind: string; href: string }[] };

export async function purchaseTaxRows(db: Db, range: [string, string] | null, statuses: string[], withCancel: boolean): Promise<PurchaseTaxRow[]> {
  const rows = await db.q<any>(`select d.*, coalesce(c.business_name, c.contact_name, '-') name, coalesce(t.vendor_tax_id, c.tax_id) tax_id, c.branch_code, c.is_cash_default,
      t.invoice_no inv_no, t.vat_form, t.invoice_date inv_date, t.base_amount inv_base, t.vat_amount inv_vat from (
        select 'RI' kind, g.id, g.ri_no no, g.ri_date date, g.contact_id, g.status, g.subtotal sub, g.vat, g.created_at, (select po.po_no from purchase_orders po where po.id = g.po_id) ref_no from goods_receipts g
        union all select 'EXP', e.id, e.exp_no, e.exp_date, e.contact_id, e.status, e.subtotal, e.vat, e.created_at, null from expenses e) d
      join contacts c on c.id = d.contact_id left join purchase_tax_invoices t on t.doc_type = d.kind and t.doc_id = d.id
    where d.vat > 0 and ($1::date is null or d.date >= $1::date) and ($2::date is null or d.date <= $2::date)
      and ${withCancel ? 'true' : `d.status not in ('rejected','cancelled')`} and (cardinality($3::text[]) = 0 or d.status = any($3::text[]))
    order by d.kind desc, d.no`, [range?.[0] ?? null, range?.[1] ?? null, pgArr(statuses)]);
  const m = new Map<string, any[]>([...(await related(db, 'exp', rows.filter(r => r.kind === 'EXP').map(r => r.id))), ...(await related(db, 'ri', rows.filter(r => r.kind === 'RI').map(r => r.id)))]);
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

// ---------- รายงานภาษีซื้อ ภ.พ.30 / ภ.พ.36 แบบ FA (REA 29-10-2026) ----------
export type InputTaxRow = { kind: 'inv' | 'rd'; date: string; no: string; doc_no: string | null; rd_date: string | null; rd_no: string | null; name: string; tax_id: string | null; branch: string;
  project: string | null; base: number; vat: number; status: string; filed: boolean; round: string; doc_href: string | null };
const monthKey = (d: any) => String(d instanceof Date ? d.toISOString() : d).slice(0, 7);
const roundName = (n: number) => (n === 0 ? 'ยื่นปกติ' : `ยื่นเพิ่มเติม-${n}`);
const brOf = (b: string | null) => branchLabel({ branch_code: b && /^[0-9]{5}$/.test(b) ? b : null });
const docHref = (t: string, id: string) => (t === 'EXP' ? `/expenses/${id}` : `/purchases/ri/${id}`);

/** ภ.พ.30 ฝั่งซื้อ: ใบกำกับ ภ.พ.30 ที่รับแล้ว (+ แถวใบเสร็จสรรพากรของ ภ.พ.36 เมื่อ withRd) · รอบ/สถานะรายเอกสารจากแบบที่ติ๊กเลือก (pp30_filing_docs) ไม่อยู่ในแบบ = รอยื่นรอบถัดไป */
export async function inputTaxPp30Rows(db: Db, range: [string, string] | null, fs: string, withRd: boolean): Promise<InputTaxRow[]> {
  const f = await db.q<any>(`select id, period_month, seq, status from pp30_filings where status = 'filed'`);
  const nextSeq = (k: string) => f.filter(x => monthKey(x.period_month) === k).length;
  const rnd = (k: string, seq: number) => `${k.slice(5, 7)}-${k.slice(0, 4)} (${roundName(seq)})`;
  const fil = new Map<string, any>(f.map(x => [x.id, x]));
  const inv = await db.q<any>(`select t.doc_type, t.doc_id, t.invoice_date, t.invoice_no, t.vendor_name, t.vendor_tax_id, t.branch, t.base_amount, t.vat_amount,
      coalesce(e.exp_no, g.ri_no) doc_no, coalesce(e.project, g.project) project, d.filing_id
    from purchase_tax_invoices t left join expenses e on t.doc_type = 'EXP' and e.id = t.doc_id left join goods_receipts g on t.doc_type = 'RI' and g.id = t.doc_id
      left join pp30_filing_docs d on d.doc_type = t.doc_type and d.doc_id = t.doc_id
    where t.vat_form = 'PP30' and ($1::date is null or t.invoice_date >= $1::date) and ($2::date is null or t.invoice_date <= $2::date)
      and coalesce(e.status, g.status) not in ('rejected','cancelled') order by t.invoice_date, t.invoice_no`, [range?.[0] ?? null, range?.[1] ?? null]);
  const out: InputTaxRow[] = inv.map(r => {
    const k = monthKey(r.invoice_date), fl = r.filing_id ? fil.get(r.filing_id) : null;
    return { kind: 'inv' as const, date: r.invoice_date, no: r.invoice_no, doc_no: r.doc_no, rd_date: null, rd_no: null, name: r.vendor_name, tax_id: r.vendor_tax_id, branch: brOf(r.branch), project: r.project ?? null,
      base: Number(r.base_amount), vat: Number(r.vat_amount), filed: !!fl, status: fl ? 'ยื่นแบบภาษีแล้ว' : 'รอยื่นแบบภาษี', round: fl ? rnd(monthKey(fl.period_month), fl.seq) : rnd(k, nextSeq(k)), doc_href: docHref(r.doc_type, r.doc_id) };
  });
  if (withRd) {
    const rd = await db.q<any>(`select d.doc_type, d.doc_id, d.rd_receipt_no, d.rd_receipt_date, d.base_amount, d.vat_amount, coalesce(e.exp_no, g.ri_no) doc_no, coalesce(e.project, g.project) project, p.filing_id
      from pp36_filing_docs d join pp36_filings pf on pf.id = d.filing_id and pf.status = 'filed'
        left join expenses e on d.doc_type = 'EXP' and e.id = d.doc_id left join goods_receipts g on d.doc_type = 'RI' and g.id = d.doc_id
        left join pp30_filing_docs p on p.doc_type = d.doc_type and p.doc_id = d.doc_id
      where d.rd_receipt_no is not null and ($1::date is null or d.rd_receipt_date >= $1::date) and ($2::date is null or d.rd_receipt_date <= $2::date) order by d.rd_receipt_date, d.rd_receipt_no`, [range?.[0] ?? null, range?.[1] ?? null]);
    for (const r of rd) {
      const k = monthKey(r.rd_receipt_date), fl = r.filing_id ? fil.get(r.filing_id) : null;
      out.push({ kind: 'rd', date: r.rd_receipt_date, no: r.rd_receipt_no, doc_no: r.doc_no, rd_date: null, rd_no: null, name: 'กรมสรรพากร', tax_id: null, branch: '', project: r.project ?? null,
        base: Number(r.base_amount), vat: Number(r.vat_amount), filed: !!fl, status: fl ? 'ยื่นแบบภาษีแล้ว' : 'รอยื่นแบบภาษี', round: fl ? rnd(monthKey(fl.period_month), fl.seq) : rnd(k, nextSeq(k)), doc_href: docHref(r.doc_type, r.doc_id) });
    }
    out.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }
  return out.filter(r => !fs || (fs === 'filed') === r.filed);
}

/** ภ.พ.36: ใบกำกับของผู้ขายต่างประเทศ (vat_form = PP36) + เลขที่/วันที่ใบเสร็จสรรพากร · สถานะ ชำระภาษีแล้ว = แบบ ภ.พ.36 ที่ยื่นมีการชำระแล้ว */
export async function inputTaxPp36Rows(db: Db, range: [string, string] | null, fs: string): Promise<InputTaxRow[]> {
  const rows = await db.q<any>(`select t.doc_type, t.doc_id, t.invoice_date, t.invoice_no, t.vendor_name, t.vendor_tax_id, t.branch, t.base_amount, t.vat_amount,
      coalesce(e.exp_no, g.ri_no) doc_no, coalesce(e.project, g.project) project, d.rd_receipt_no, d.rd_receipt_date, pf.paid_date
    from purchase_tax_invoices t left join expenses e on t.doc_type = 'EXP' and e.id = t.doc_id left join goods_receipts g on t.doc_type = 'RI' and g.id = t.doc_id
      left join pp36_filing_docs d on d.doc_type = t.doc_type and d.doc_id = t.doc_id left join pp36_filings pf on pf.id = d.filing_id and pf.status = 'filed'
    where t.vat_form = 'PP36' and ($1::date is null or t.invoice_date >= $1::date) and ($2::date is null or t.invoice_date <= $2::date)
      and coalesce(e.status, g.status) not in ('rejected','cancelled') order by t.invoice_date, t.invoice_no`, [range?.[0] ?? null, range?.[1] ?? null]);
  return rows.map(r => ({ kind: 'inv' as const, date: r.invoice_date, no: r.invoice_no, doc_no: r.doc_no, rd_date: r.rd_receipt_date ?? null, rd_no: r.rd_receipt_no ?? null, name: r.vendor_name, tax_id: r.vendor_tax_id, branch: brOf(r.branch),
    project: r.project ?? null, base: Number(r.base_amount), vat: Number(r.vat_amount), filed: !!r.paid_date, status: r.paid_date ? 'ชำระภาษีแล้ว' : 'รอชำระภาษี', round: '', doc_href: docHref(r.doc_type, r.doc_id) }))
    .filter(r => !fs || (fs === 'paid') === r.filed);
}
