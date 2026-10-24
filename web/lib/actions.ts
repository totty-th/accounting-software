'use server';
import { revalidatePath } from 'next/cache';
import { getDb, today } from './db';
import { currentUser, type AuthUser } from './auth';
import { can, type Perm } from './permissions';

export type Result = { error?: string; ok?: true };

// ตรวจสิทธิ์ที่ฝั่งเซิร์ฟเวอร์ทุกครั้ง (การซ่อนปุ่มบนหน้าจอเป็นแค่ความสะดวก) แล้วตัดข้อความ error ของ Postgres ให้อ่านรู้เรื่อง
type Gate = Perm | Perm[] | ((u: AuthUser) => boolean | Promise<boolean>);
const NO_PERM = 'ไม่มีสิทธิ์ทำรายการนี้';
async function run(fn: (u: AuthUser) => Promise<unknown>, paths: string[], gate: Gate): Promise<Result> {
  const u = await currentUser();
  if (!u) return { error: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่' };
  const ok = typeof gate === 'function' ? await gate(u) : ([] as Perm[]).concat(gate).some(p => can(u.role, p));
  if (!ok) return { error: NO_PERM };
  try { await fn(u); } catch (e: any) {
    const m = String(e?.message ?? e).replace(/^error:\s*/i, '').replace(/^PERIOD_LOCKED:\s*/, '');
    return { error: m };
  }
  paths.forEach(p => revalidatePath(p));
  return { ok: true };
}
const ALL = ['/', '/sales', '/receipts', '/expenses', '/reports/trial-balance', '/reports/pnl', '/stock'];
const call = (sql: string, ...p: unknown[]) => async () => (await getDb()).q(sql, p);
/** ฝ่ายขาย (quote.own) ทำได้เฉพาะใบเสนอราคาที่ตัวเองสร้าง */
const ownQuote = async (u: AuthUser, id: string) =>
  (await (await getDb()).q(`select 1 from sales_docs where id=$1 and doc_type='QT' and created_by=$2`, [id, u.id])).length > 0;
const salesDocGate = (id: string): Gate => async u => can(u.role, 'sales.write') || (can(u.role, 'quote.own') && (await ownQuote(u, id)));

export async function createSalesDoc(p: { type: string; date: string; contact: string | null; mode: string; lines: any[]; reason?: string; ref?: string }) {
  // set_config(..., true) อยู่ใน FROM ของคำสั่งเดียวกัน → trigger บันทึกผู้สร้างเอกสาร และค่าไม่รั่วไปคำสั่งอื่น
  return run(u => call(`select create_sales_doc($2,$3::date,$4,$5::jsonb,$6,7,$7,$8) from (select set_config('app.user_id',$1,true)) s`,
    u.id, p.type, p.date, p.contact || null, JSON.stringify(p.lines), p.mode, p.ref || null, p.reason || null)(), ALL,
    u => can(u.role, 'sales.write') || (can(u.role, 'quote.own') && p.type === 'QT'));
}
/** เรียกฟังก์ชันพร้อมตั้งผู้ทำรายการ (app.user_id) ในคำสั่งเดียวกัน เพื่อให้ประวัติเอกสารรู้ว่าใครทำ */
const callAs = (uid: string, fn: string, ...p: unknown[]) =>
  call(`select ${fn.replace(/\$(\d+)/g, (_, n) => '$' + (Number(n) + 1))} from (select set_config('app.user_id',$1,true)) s`, uid, ...p)();
export const cancelSalesDoc = async (id: string) => run(u => callAs(u.id, 'cancel_sales_doc($1)', id), ALL, salesDocGate(id));
export const restoreSalesDoc = async (id: string) => run(u => callAs(u.id, 'restore_sales_doc($1)', id), ALL, 'sales.write');
export const saveSalesNote = async (id: string, note: string) =>
  run(u => callAs(u.id, 'set_sales_doc_note($1,$2)', id, note), [`/sales/${id}`], salesDocGate(id));
export const setDnWht = async (id: string, rate: number) =>
  run(u => callAs(u.id, 'set_debit_note_wht($1,$2)', id, rate), ALL.concat(`/sales/${id}`), 'sales.write');
export async function uploadSalesFile(f: FormData): Promise<Result> {
  const id = String(f.get('id') ?? ''); const file = f.get('file') as File | null;
  if (!file || !file.size) return { error: 'กรุณาเลือกไฟล์' };
  if (file.size > 5 * 1024 * 1024) return { error: 'ไฟล์ใหญ่เกิน 5 MB' };
  const b64 = Buffer.from(await file.arrayBuffer()).toString('base64');
  return run(u => callAs(u.id, "add_sales_doc_file($1,$2,$3,decode($4,'base64'))", id, file.name, file.type, b64), [`/sales/${id}`], salesDocGate(id));
}
export const removeSalesFile = async (docId: string, fileId: string) =>
  run(u => callAs(u.id, 'remove_sales_doc_file($1)', fileId), [`/sales/${docId}`], salesDocGate(docId));
export const approveQuote = async (id: string) => run(call('select approve_quotation($1)', id), ALL, 'sales.approve');
export const quoteToInvoice = async (id: string) => run(call('select quotation_to_invoice($1,$2::date)', id, today()), ALL, 'sales.write');
export const collectCash = async (id: string) => run(call('select collect_cash_sale($1,$2::date)', id, today()), ALL, 'sales.write');
export const resetCash = async (id: string) => run(call('select reset_cash_sale($1)', id), ALL, 'sales.write');

export const createReceipt = async (inv: string) => run(call('select create_receipt_from_invoice($1,$2::date)', inv, today()), ALL, 'receipts.write');
export const collectReceipt = async (id: string, payments?: { method: string; bank_account_id?: string; amount: number }[]) =>
  run(call('select collect_receipt($1,$2::date,$3::jsonb)', id, today(), payments && payments.length ? JSON.stringify(payments) : null), ALL, 'receipts.write');
export async function createReceiptShareLink(id: string): Promise<Result> {
  return run(call('select ensure_receipt_share_token($1)', id), ['/receipts'], 'receipts.write');
}
export async function revokeReceiptShareLink(id: string): Promise<Result> {
  return run(call('select revoke_receipt_share_token($1)', id), ['/receipts'], 'receipts.write');
}
export const resetReceipt = async (id: string) => run(call('select reset_receipt($1)', id), ALL, 'receipts.write');
export const cancelReceipt = async (id: string) => run(call('select cancel_receipt($1)', id), ALL, 'receipts.write');

export async function createExpense(p: { date: string; contact: string; lines: any[] }) {
  return run(call('select create_expense($1::date,$2,$3::jsonb)', p.date, p.contact, JSON.stringify(p.lines)), ALL, 'expenses.write');
}
export const approveExpense = async (id: string) => run(call('select approve_expense($1)', id), ALL, 'expenses.approve');
export type PurchasePay = { method: string; bank_account_id?: string; credit_card_id?: string; amount: number };
const payJson = (p?: PurchasePay[]) => (p && p.length ? JSON.stringify(p) : null);
export const payExpense = async (id: string, payments?: PurchasePay[]) =>
  run(call(`select pay_expense($1,$2::date,'11112',true,'PND53',null,$3::jsonb)`, id, today(), payJson(payments)), ALL, 'expenses.write');
export const rejectExpense = async (id: string) => run(call('select reject_expense($1)', id), ALL, 'expenses.approve');
// ใบรับสินค้า (RI)
export async function createGoodsReceipt(p: { date: string; contact: string; lines: any[] }) {
  return run(call('select create_goods_receipt($1::date,$2,$3::jsonb)', p.date, p.contact, JSON.stringify(p.lines)), [...ALL, '/purchases'], 'expenses.write');
}
export const approveGoodsReceipt = async (id: string) => run(call('select approve_goods_receipt($1)', id), [...ALL, '/purchases'], 'expenses.approve');
export const rejectGoodsReceipt = async (id: string) => run(call('select reject_goods_receipt($1)', id), [...ALL, '/purchases'], 'expenses.approve');
export const resetGoodsReceipt = async (id: string) => run(call('select reset_goods_receipt($1)', id), [...ALL, '/purchases'], 'expenses.write');
export const cancelGoodsReceipt = async (id: string) => run(call('select cancel_goods_receipt($1)', id), [...ALL, '/purchases'], 'expenses.write');
export const payGoodsReceipt = async (id: string, payments?: PurchasePay[]) =>
  run(call('select pay_goods_receipt($1,$2::date,$3::jsonb)', id, today(), payJson(payments)), [...ALL, '/purchases'], 'expenses.write');
export const createCreditCard = async (p: { bank: string; last4: string; holder: string; name: string; limit: number; statementDay: number; dueDay: number }) =>
  run(call('select create_credit_card($1,$2,$3,$4,$5,$6,$7)', p.bank, p.last4, p.holder, p.name, p.limit, p.statementDay, p.dueDay),
    ['/expenses', '/purchases'], 'master.write');
export const resetExpense = async (id: string) => run(call('select reset_expense($1)', id), ALL, 'expenses.write');
export const cancelExpense = async (id: string) => run(call('select cancel_expense($1)', id), ALL, 'expenses.write');

export async function saveContact(id: string | null, p: Record<string, unknown>): Promise<Result & { id?: string }> {
  let out: string | undefined;
  const r = await run(async () => { out = (await (await getDb()).q<any>('select contact_save($1,$2::jsonb) as id', [id, JSON.stringify(p)]))[0].id; },
    ['/contacts', '/sales', '/expenses'], id ? ['master.write', 'contact.create'] : 'contact.create');
  return { ...r, id: out };
}
export async function createContact(p: { business_name: string; contact_name: string; tax_id: string }) {
  return run(call('insert into contacts(business_name,contact_name,tax_id) values (nullif($1,\'\'),nullif($2,\'\'),nullif($3,\'\'))',
    p.business_name, p.contact_name, p.tax_id), ['/contacts', '/sales', '/expenses'], 'contact.create');
}
export async function createProduct(p: { code: string; name: string; kind: string; unit: string; sale: number; buy: number }) {
  return run(call('insert into products(code,name,kind,base_unit,sale_price,purchase_price) values ($1,$2,$3,$4,$5,$6)',
    p.code, p.name, p.kind, p.unit || 'ชิ้น', p.sale || 0, p.buy || 0), ['/products', '/sales', '/stock'], 'master.write');
}

// ---- หนังสือรับรองหัก ณ ที่จ่าย (50 ทวิ) ----
const str = (f: FormData, k: string) => { const v = String(f.get(k) ?? '').trim(); return v === '' ? undefined : v; };
export async function saveCertDetails(f: FormData): Promise<void> {
  const num = (k: string) => { const v = str(f, k); return v === undefined ? undefined : Number(v); };
  const d = { book_no: str(f, 'book_no'), run_no: str(f, 'run_no'), seq_in_form: num('seq_in_form'),
    income_category: str(f, 'income_category'), payer_condition: str(f, 'payer_condition'),
    payer_condition_note: str(f, 'payer_condition_note'), fund_gpf: num('fund_gpf'), fund_sso: num('fund_sso'), fund_pvd: num('fund_pvd') };
  await run(call('select set_cert_details($1,$2::jsonb)', str(f, 'id'), JSON.stringify(d)), ['/wht'], 'wht.write');
}
export async function saveCompany(f: FormData): Promise<void> {
  await run(call(`insert into company_profile(name,address,tax_id) values ($1,$2,$3)
    on conflict (singleton) do update set name=excluded.name, address=excluded.address, tax_id=excluded.tax_id`,
    str(f, 'name'), str(f, 'address'), str(f, 'tax_id')), ['/wht', '/settings/company'], 'settings.company');
}
export async function saveContactTax(f: FormData): Promise<void> {
  await run(call('update contacts set tax_id=$2, address=$3, person_kind=$4 where id=$1',
    str(f, 'id'), str(f, 'tax_id') ?? null, str(f, 'address') ?? null, str(f, 'person_kind') ?? null), ['/wht', '/contacts'], 'wht.write');
}

// ---- ลิงก์แชร์เอกสารขาย ----
export async function createShareLink(id: string): Promise<Result> {
  return run(call('select ensure_share_token($1)', id), [`/sales/${id}`], salesDocGate(id));
}
export async function revokeShareLink(id: string): Promise<Result> {
  return run(call('select revoke_share_token($1)', id), [`/sales/${id}`], salesDocGate(id));
}

// ---- บัญชีธนาคาร / กระทบยอด ----
const BANK = ['/bank'];
export async function createBankAccount(p: { bank: string; no: string; name: string }) {
  return run(call('select bank_account_create($1,$2,nullif($3,\'\'))', p.bank, p.no, p.name), BANK, 'bank.write');
}
export async function importStatement(p: { bank: string; file: string; rows: any[]; skipDups?: boolean }) {
  return run(call('select bank_statement_import($1,$2,$3::jsonb,$4)', p.bank, p.file, JSON.stringify(p.rows), !!p.skipDups), BANK, 'bank.write');
}
// ตรวจรายการที่เคยนำเข้าแล้ว ก่อนกดนำเข้าจริง (คืนเลขแถวที่ซ้ำ เริ่มที่ 1)
export async function checkStatementDups(p: { bank: string; rows: any[] }): Promise<{ error?: string; dups?: number[] }> {
  try {
    const r = await (await getDb()).q('select row_no from bank_statement_dups($1,$2::jsonb) where is_dup order by row_no', [p.bank, JSON.stringify(p.rows)]);
    return { dups: (r as any[]).map(x => Number(x.row_no)) };
  } catch (e: any) { return { error: String(e?.message ?? e).replace(/^error:\s*/i, '') }; }
}
export async function bankMatch(lines: string[], items: string[]) {
  return run(call('select bank_match($1::uuid[],$2::uuid[])', lines, items), BANK, 'bank.write');
}
export async function bankMatchDiff(p: { lines: string[]; items: string[]; account: string; memo: string; date?: string }) {
  return run(call('select bank_match_with_diff($1::uuid[],$2::uuid[],$3,$4,$5::date)',
    p.lines, p.items, p.account, p.memo, p.date || null), [...BANK, ...ALL], 'bank.write');
}
export async function bankUnmatch(line: string, diffAction?: 'cancel' | 'keep') {
  return run(call('select bank_unmatch($1,$2)', line, diffAction ?? null), [...BANK, ...ALL], 'bank.write');
}
export async function bankTransfer(p: { from: string; to: string; date: string; amount: number; fee: number }) {
  return run(call('select bank_transfer($1,$2,$3::date,$4,$5)', p.from, p.to, p.date || today(), p.amount, p.fee || 0), [...BANK, ...ALL], 'bank.write');
}
