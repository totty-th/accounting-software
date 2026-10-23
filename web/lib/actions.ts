'use server';
import { revalidatePath } from 'next/cache';
import { getDb, today } from './db';

export type Result = { error?: string; ok?: true };

// ตัดข้อความ error ของ Postgres ให้เหลือข้อความที่ผู้ใช้อ่านรู้เรื่อง
async function run(fn: () => Promise<unknown>, paths: string[]): Promise<Result> {
  try { await fn(); } catch (e: any) {
    const m = String(e?.message ?? e).replace(/^error:\s*/i, '').replace(/^PERIOD_LOCKED:\s*/, '');
    return { error: m };
  }
  paths.forEach(p => revalidatePath(p));
  return { ok: true };
}
const ALL = ['/', '/sales', '/receipts', '/expenses', '/reports/trial-balance', '/reports/pnl', '/stock'];
const call = (sql: string, ...p: unknown[]) => async () => (await getDb()).q(sql, p);

export async function createSalesDoc(p: { type: string; date: string; contact: string | null; mode: string; lines: any[]; reason?: string; ref?: string }) {
  return run(call(`select create_sales_doc($1,$2::date,$3,$4::jsonb,$5,7,$6,$7)`,
    p.type, p.date, p.contact || null, JSON.stringify(p.lines), p.mode, p.ref || null, p.reason || null), ALL);
}
export const cancelSalesDoc = async (id: string) => run(call('select cancel_sales_doc($1)', id), ALL);
export const approveQuote = async (id: string) => run(call('select approve_quotation($1)', id), ALL);
export const quoteToInvoice = async (id: string) => run(call('select quotation_to_invoice($1,$2::date)', id, today()), ALL);
export const collectCash = async (id: string) => run(call('select collect_cash_sale($1,$2::date)', id, today()), ALL);
export const resetCash = async (id: string) => run(call('select reset_cash_sale($1)', id), ALL);

export const createReceipt = async (inv: string) => run(call('select create_receipt_from_invoice($1,$2::date)', inv, today()), ALL);
export const collectReceipt = async (id: string) => run(call('select collect_receipt($1,$2::date)', id, today()), ALL);
export const resetReceipt = async (id: string) => run(call('select reset_receipt($1)', id), ALL);
export const cancelReceipt = async (id: string) => run(call('select cancel_receipt($1)', id), ALL);

export async function createExpense(p: { date: string; contact: string; lines: any[] }) {
  return run(call('select create_expense($1::date,$2,$3::jsonb)', p.date, p.contact, JSON.stringify(p.lines)), ALL);
}
export const approveExpense = async (id: string) => run(call('select approve_expense($1)', id), ALL);
export const payExpense = async (id: string) => run(call('select pay_expense($1,$2::date)', id, today()), ALL);
export const resetExpense = async (id: string) => run(call('select reset_expense($1)', id), ALL);
export const cancelExpense = async (id: string) => run(call('select cancel_expense($1)', id), ALL);

export async function createContact(p: { business_name: string; contact_name: string; tax_id: string }) {
  return run(call('insert into contacts(business_name,contact_name,tax_id) values (nullif($1,\'\'),nullif($2,\'\'),nullif($3,\'\'))',
    p.business_name, p.contact_name, p.tax_id), ['/contacts', '/sales', '/expenses']);
}
export async function createProduct(p: { code: string; name: string; kind: string; unit: string; sale: number; buy: number }) {
  return run(call('insert into products(code,name,kind,base_unit,sale_price,purchase_price) values ($1,$2,$3,$4,$5,$6)',
    p.code, p.name, p.kind, p.unit || 'ชิ้น', p.sale || 0, p.buy || 0), ['/products', '/sales', '/stock']);
}

// ---- หนังสือรับรองหัก ณ ที่จ่าย (50 ทวิ) ----
const str = (f: FormData, k: string) => { const v = String(f.get(k) ?? '').trim(); return v === '' ? undefined : v; };
export async function saveCertDetails(f: FormData): Promise<void> {
  const num = (k: string) => { const v = str(f, k); return v === undefined ? undefined : Number(v); };
  const d = { book_no: str(f, 'book_no'), run_no: str(f, 'run_no'), seq_in_form: num('seq_in_form'),
    income_category: str(f, 'income_category'), payer_condition: str(f, 'payer_condition'),
    payer_condition_note: str(f, 'payer_condition_note'), fund_gpf: num('fund_gpf'), fund_sso: num('fund_sso'), fund_pvd: num('fund_pvd') };
  await run(call('select set_cert_details($1,$2::jsonb)', str(f, 'id'), JSON.stringify(d)), ['/wht']);
}
export async function saveCompany(f: FormData): Promise<void> {
  await run(call(`insert into company_profile(name,address,tax_id) values ($1,$2,$3)
    on conflict (singleton) do update set name=excluded.name, address=excluded.address, tax_id=excluded.tax_id`,
    str(f, 'name'), str(f, 'address'), str(f, 'tax_id')), ['/wht', '/settings/company']);
}
export async function saveContactTax(f: FormData): Promise<void> {
  await run(call('update contacts set tax_id=$2, address=$3, person_kind=$4 where id=$1',
    str(f, 'id'), str(f, 'tax_id') ?? null, str(f, 'address') ?? null, str(f, 'person_kind') ?? null), ['/wht', '/contacts']);
}

// ---- ลิงก์แชร์เอกสารขาย ----
export async function createShareLink(id: string): Promise<Result> {
  return run(call('select ensure_share_token($1)', id), [`/sales/${id}`]);
}
export async function revokeShareLink(id: string): Promise<Result> {
  return run(call('select revoke_share_token($1)', id), [`/sales/${id}`]);
}
