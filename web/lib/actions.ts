'use server';
import { revalidatePath } from 'next/cache';
import { AsyncLocalStorage } from 'node:async_hooks';
import { getDb, today } from './db';
import { currentUser, type AuthUser } from './auth';
import { can, type Perm } from './permissions';

export type Result = { error?: string; ok?: true };

// ตรวจสิทธิ์ที่ฝั่งเซิร์ฟเวอร์ทุกครั้ง (การซ่อนปุ่มบนหน้าจอเป็นแค่ความสะดวก) แล้วตัดข้อความ error ของ Postgres ให้อ่านรู้เรื่อง
type Gate = Perm | Perm[] | ((u: AuthUser) => boolean | Promise<boolean>);
const NO_PERM = 'ไม่มีสิทธิ์ทำรายการนี้';
const who = new AsyncLocalStorage<string>();
async function run(fn: (u: AuthUser) => Promise<unknown>, paths: string[], gate: Gate): Promise<Result> {
  const u = await currentUser();
  if (!u) return { error: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่' };
  const ok = typeof gate === 'function' ? await gate(u) : ([] as Perm[]).concat(gate).some(p => can(u.role, p));
  if (!ok) return { error: NO_PERM };
  try { await who.run(u.id, () => fn(u)); } catch (e: any) {
    const m = String(e?.message ?? e).replace(/^error:\s*/i, '').replace(/^PERIOD_LOCKED:\s*/, '');
    return { error: m };
  }
  paths.forEach(p => revalidatePath(p));
  return { ok: true };
}
const ALL = ['/', '/sales', '/receipts', '/expenses', '/reports/trial-balance', '/reports/pnl', '/stock'];
// ถ้าเป็นคำสั่ง `select f(...)` ที่ไม่มี from และรู้ผู้ใช้ปัจจุบัน → ตั้ง app.user_id ในคำสั่งเดียวกัน (ให้ trigger บันทึกผู้ทำรายการของใบสำคัญ/เอกสาร)
const call = (sql: string, ...p: unknown[]) => async () => {
  const uid = who.getStore();
  if (uid && /^\s*select\s/i.test(sql) && !/\sfrom\s/i.test(sql) && !/set_config\('app\.user_id'/.test(sql))
    return (await getDb()).q(`${sql} from (select set_config('app.user_id',$${p.length + 1},true)) _u`, [...p, uid]);
  return (await getDb()).q(sql, p);
};
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
export const setDelivery = async (id: string, p: { mode: string; name?: string; address?: string; phone?: string; carrier?: string; note?: string }) =>
  run(u => callAs(u.id, 'set_delivery($1,$2::jsonb)', id, JSON.stringify(p)), [`/sales/${id}`, `/sales/${id}/delivery`], salesDocGate(id));
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
export const approveQuote = async (id: string) => run(u => callAs(u.id, 'approve_quotation($1)', id), ALL, 'sales.approve');
export const rejectQuote = async (id: string) => run(u => callAs(u.id, 'reject_quotation($1)', id), ALL, 'sales.approve');
export const resetQuote = async (id: string) => run(u => callAs(u.id, 'reset_quotation($1)', id), ALL, 'sales.approve');
export const duplicateQuote = async (id: string) => run(u => callAs(u.id, 'duplicate_quotation($1,$2::date)', id, today()), ALL, salesDocGate(id));
/** สร้าง (id=null) หรือแก้ไข (เฉพาะรออนุมัติ) ใบเสนอราคาเต็มรูปแบบ */
/** พนักงานขายยึดตามบัญชีที่ล็อกอิน (ฝั่งเซิร์ฟเวอร์บังคับ) · super_admin เลือกเองได้ · ตอนแก้ใบเดิมคงพนักงานเดิมไว้ */
async function forceSalesperson(u: AuthUser, header: Record<string, unknown>, existing?: string | null) {
  if (u.role === 'super_admin') return header;
  return { ...header, salesperson: existing || u.displayName || u.username };
}
export async function saveQuotation(id: string | null, header: Record<string, unknown>, lines: any[]): Promise<Result & { id?: string }> {
  let out: string | undefined;
  const r = await run(async u => {
    const old = id ? (await (await getDb()).q<any>('select salesperson from sales_docs where id=$1', [id]))[0]?.salesperson : null;
    out = (await (await getDb()).q<any>(`select save_quotation($2,$3::jsonb,$4::jsonb) as id from (select set_config('app.user_id',$1,true)) s`,
      [u.id, id, JSON.stringify(await forceSalesperson(u, header, old)), JSON.stringify(lines)]))[0].id;
  }, id ? [...ALL, `/sales/${id}`] : ALL, async u => can(u.role, 'sales.write') || (can(u.role, 'quote.own') && (!id || (await ownQuote(u, id)))));
  return { ...r, id: out };
}
/** สร้างใบแจ้งหนี้เต็มรูปแบบ (ส่วนลด/ภาษี/หัก ณ ที่จ่ายต่อบรรทัด) */
export async function saveInvoice(header: Record<string, unknown>, lines: any[]): Promise<Result & { id?: string }> {
  let out: string | undefined;
  const r = await run(async u => {
    out = (await (await getDb()).q<any>(`select create_invoice_full($2::jsonb,$3::jsonb) as id from (select set_config('app.user_id',$1,true)) s`,
      [u.id, JSON.stringify(await forceSalesperson(u, header)), JSON.stringify(lines)]))[0].id;
  }, ALL, 'sales.write');
  return { ...r, id: out };
}
/** แก้ไขใบแจ้งหนี้ที่บันทึกแล้ว (M23): ยังไม่มีเอกสารผูก = แก้ได้ทุกช่อง แก้ทับใบสำคัญเดิม · มีเอกสารผูก = แก้ได้เฉพาะข้อมูลทั่วไป */
export async function updateSalesDoc(id: string, header: Record<string, unknown>, lines: any[]): Promise<Result> {
  return run(async u => {
    const old = (await (await getDb()).q<any>('select salesperson from sales_docs where id=$1', [id]))[0]?.salesperson;
    await (await getDb()).q(`select update_sales_doc($2,$3::jsonb,$4::jsonb) from (select set_config('app.user_id',$1,true)) s`,
      [u.id, id, JSON.stringify(await forceSalesperson(u, header, old)), JSON.stringify(lines)]);
  }, [...ALL, `/sales/${id}`], 'sales.write');
}
export const duplicateInvoice = async (id: string) => run(u => callAs(u.id, 'duplicate_invoice($1,$2::date)', id, today()), ALL, 'sales.write');
/** เรียกเก็บเงินจากใบเสนอราคา: kind INV|CA|BL · mode all|percent|amount|qty */
export async function billQuotation(id: string, kind: 'INV' | 'CA' | 'BL', mode: 'all' | 'percent' | 'amount' | 'qty' = 'all',
  value: number | null = null, qtys: Record<string, number> | null = null): Promise<Result & { id?: string }> {
  let out: string | undefined;
  const r = await run(async u => {
    out = (await (await getDb()).q<any>(`select quotation_bill($2,$3,$4::date,$5,$6::numeric,$7::jsonb) as id from (select set_config('app.user_id',$1,true)) s`,
      [u.id, id, kind, today(), mode, value, qtys ? JSON.stringify(qtys) : null]))[0].id;
  }, [...ALL, `/sales/${id}`], 'sales.write');
  return { ...r, id: out };
}
export const closeQuotation = async (id: string) => run(u => callAs(u.id, 'close_quotation($1)', id), [...ALL, `/sales/${id}`], 'sales.write');
export const reopenQuotation = async (id: string) => run(u => callAs(u.id, 'reopen_quotation($1)', id), [...ALL, `/sales/${id}`], 'sales.write');
export const quoteToInvoice = async (id: string) => run(call('select quotation_to_invoice($1,$2::date)', id, today()), ALL, 'sales.write');
export const createDeposit = async (id: string, net: number, kind: 'INV' | 'CA' | 'BL' = 'INV') => run(u => callAs(u.id, 'create_deposit_doc($1,$2,$3::date,$4::numeric)', id, kind, today(), net), ALL, 'sales.write');
export const createFinalInvoice = async (id: string, kind: 'INV' | 'CA' | 'BL' = 'INV') => run(u => callAs(u.id, 'create_final_invoice($1,$2::date,$3)', id, today(), kind), ALL, 'sales.write');
export const convertDepositBl = async (id: string) => run(u => callAs(u.id, 'convert_deposit_bl($1,$2::date)', id, today()), ALL, 'sales.write');
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
export type PurchasePay = { method: string; bank_account_id?: string; credit_card_id?: string; petty_fund_id?: string;
  cheque_no?: string; cheque_date?: string; clear_date?: string; amount: number };
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
export const payGoodsReceipt = async (id: string, payments?: PurchasePay[], shortReason?: string) =>
  run(call('select pay_goods_receipt($1,$2::date,$3::jsonb,$4)', id, today(), payJson(payments), shortReason ?? null), [...ALL, '/purchases'], 'expenses.write');
export const createPettyFund = async (p: { name: string; limit: number; responsible: string }) =>
  run(call('select create_petty_fund($1,$2,$3)', p.name, p.limit, p.responsible || null), ['/expenses', '/purchases'], 'master.write');
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

// ใบสั่งซื้อ (PO)
const PO = [...ALL, '/purchases/orders', '/purchases'];
export async function createPurchaseOrder(p: { date: string; contact: string; lines: any[] }) {
  return run(call('select create_purchase_order($1::date,$2,$3::jsonb)', p.date, p.contact, JSON.stringify(p.lines)), PO, 'expenses.write');
}
export async function savePurchaseOrder(id: string | null, header: Record<string, unknown>, lines: any[]): Promise<Result & { id?: string }> {
  let out: string | undefined;
  const r = await run(async () => { out = (await (await getDb()).q<any>('select save_purchase_order($1,$2::jsonb,$3::jsonb) as id', [id, JSON.stringify(header), JSON.stringify(lines)]))[0].id; },
    [...PO, '/purchases/orders/new'], 'expenses.write');
  return { ...r, id: out };
}
export async function saveGoodsReceiptFull(header: Record<string, unknown>, lines: any[]): Promise<Result & { id?: string }> {
  let out: string | undefined;
  const r = await run(async () => { out = (await (await getDb()).q<any>('select save_goods_receipt($1::jsonb,$2::jsonb) as id', [JSON.stringify(header), JSON.stringify(lines)]))[0].id; },
    [...ALL, '/purchases', '/purchases/new'], 'expenses.write');
  return { ...r, id: out };
}
export async function saveExpenseFull(header: Record<string, unknown>, lines: any[]): Promise<Result & { id?: string }> {
  let out: string | undefined;
  const r = await run(async () => { out = (await (await getDb()).q<any>('select save_expense($1::jsonb,$2::jsonb) as id', [JSON.stringify(header), JSON.stringify(lines)]))[0].id; },
    [...ALL, '/expenses', '/expenses/new'], 'expenses.write');
  return { ...r, id: out };
}
export async function saveExpenseFromPo(po: string, header: Record<string, unknown>, lines: any[]): Promise<Result & { id?: string }> {
  let out: string | undefined;
  const r = await run(async () => { out = (await (await getDb()).q<any>('select save_expense_from_po($1::uuid,$2::jsonb,$3::jsonb) as id', [po, JSON.stringify(header), JSON.stringify(lines)]))[0].id; },
    [...ALL, '/expenses', '/expenses/new', '/purchases/orders'], 'expenses.write');
  return { ...r, id: out };
}
export const duplicatePurchaseOrder = async (id: string) => run(call('select duplicate_purchase_order($1,$2::date)', id, today()), PO, 'expenses.write');
/** สร้างผู้จำหน่าย/สินค้าใหม่จากหน้าใบสั่งซื้อ (คืนข้อมูลให้เลือกต่อได้ทันที) */
export async function quickCreateVendor(p: { name: string; tax_id: string; address: string }): Promise<Result & { vendor?: any }> {
  let out: any;
  const r = await run(async () => { out = (await (await getDb()).q<any>(
    `insert into contacts(business_name, tax_id, address, is_customer, is_vendor) values ($1, nullif($2,''), nullif($3,''), false, true)
     returning id, business_name, tax_id, address, postal_code, branch_code, credit_days`, [p.name.trim(), p.tax_id.trim(), p.address.trim()]))[0]; },
    ['/contacts', '/purchases/orders'], 'contact.create');
  return { ...r, vendor: out };
}
export async function quickCreateCustomer(p: { name: string; tax_id: string; address: string }): Promise<Result & { customer?: any }> {
  let out: any;
  const r = await run(async () => { out = (await (await getDb()).q<any>(
    `insert into contacts(business_name, tax_id, address, is_customer, is_vendor) values ($1, nullif($2,''), nullif($3,''), true, false)
     returning id, business_name, tax_id, address, postal_code, branch_code, credit_days`, [p.name.trim(), p.tax_id.trim(), p.address.trim()]))[0]; },
    ['/contacts', '/sales'], 'contact.create');
  return { ...r, customer: out };
}
export async function quickCreateSaleProduct(p: { kind: string; name: string; code: string; unit: string; price: number; description: string }): Promise<Result & { product?: any }> {
  let out: any;
  if (!['service', 'goods_nostock', 'goods_stock'].includes(p.kind)) return { error: 'ประเภทสินค้าไม่ถูกต้อง' };
  const r = await run(async () => { out = (await (await getDb()).q<any>(
    `insert into products(code,name,kind,base_unit,sale_price,description) values (coalesce(nullif($1,''), 'NEW-' || substr(md5(random()::text || clock_timestamp()::text), 1, 8)),$2,$3,coalesce(nullif($4,''),'ชิ้น'),$5,nullif($6,''))
     returning id, code, name, kind, base_unit, sale_price, description`, [p.code.trim(), p.name.trim(), p.kind, p.unit.trim(), p.price || 0, p.description.trim()]))[0]; },
    ['/products', '/stock', '/sales'], u => can(u.role, 'master.write') || can(u.role, 'quote.own'));
  return { ...r, product: out };
}
export async function quickCreateProduct(p: { code: string; name: string; unit: string; buy: number }): Promise<Result & { product?: any }> {
  let out: any;
  const r = await run(async () => { out = (await (await getDb()).q<any>(
    `insert into products(code,name,kind,base_unit,purchase_price) values ($1,$2,'goods_stock',$3,$4) returning id, code, name, base_unit, purchase_price`,
    [p.code.trim(), p.name.trim(), p.unit.trim() || 'ชิ้น', p.buy || 0]))[0]; }, ['/products', '/stock', '/purchases/orders'], 'master.write');
  return { ...r, product: out };
}
export async function saveSignatures(f: FormData): Promise<void> {
  const img = async (k: string) => { const file = f.get(k) as File | null; if (!file || !file.size) return null;
    if (file.size > 600 * 1024) throw new Error('รูปใหญ่เกิน 600 KB'); if (!/^image\/(png|jpeg)$/.test(file.type)) throw new Error('รองรับเฉพาะ PNG/JPG');
    return `data:${file.type};base64,${Buffer.from(await file.arrayBuffer()).toString('base64')}`; };
  const clr = (k: string) => f.get(k) === '1';
  await run(async () => {
    const sig = await img('signature'), stp = await img('stamp'); const db = await getDb();
    if (sig) await db.q('update company_profile set signature_img=$1', [sig]); if (clr('clear_signature')) await db.q('update company_profile set signature_img=null');
    if (stp) await db.q('update company_profile set stamp_img=$1', [stp]); if (clr('clear_stamp')) await db.q('update company_profile set stamp_img=null');
  }, ['/settings/company'], 'settings.company');
}
export const approvePurchaseOrder = async (id: string) => run(call('select approve_purchase_order($1)', id), PO, 'expenses.approve');
export const rejectPurchaseOrder = async (id: string) => run(call('select reject_purchase_order($1)', id), PO, 'expenses.approve');
export const resetPurchaseOrder = async (id: string) => run(call('select reset_purchase_order($1)', id), PO, 'expenses.write');
export const cancelPurchaseOrder = async (id: string) => run(call('select cancel_purchase_order($1)', id), PO, 'expenses.write');
export const upgradePoToRi = async (id: string) => run(call('select upgrade_po_to_ri($1)', id), PO, 'expenses.write');
export const splitPoToRi = async (id: string, date: string, mode: 'percent' | 'amount', value: number, receiveStock: boolean) =>
  run(call('select split_ri_from_po($1,$2::date,$3,$4,$5)', id, date, mode, value, receiveStock), PO, 'expenses.write');
// ใบเตรียมจ่าย
const SLIP = [...ALL, '/payments', '/purchases'];
export async function createPaymentSlip(p: { date: string; due: string; docs: { type: string; id: string }[]; preparer?: string; requester?: string; approver?: string; reason?: string }) {
  return run(call('select create_payment_slip($1::date,$2::date,$3::jsonb,$4,$5,$6,$7)', p.date, p.due || null, JSON.stringify(p.docs),
    p.preparer || null, p.requester || null, p.approver || null, p.reason || null), SLIP, 'expenses.write');
}
export const payPaymentSlipVendor = async (slip: string, contact: string, payments?: PurchasePay[]) =>
  run(call('select pay_payment_slip_vendor($1,$2,$3::date,$4::jsonb)', slip, contact, today(), payJson(payments)), SLIP, 'expenses.write');
export const cancelPaymentSlip = async (id: string) => run(call('select cancel_payment_slip($1)', id), SLIP, 'expenses.write');

// ---- M18.4 ใบกำกับภาษีที่ได้รับ · WT อิสระ · ลิงก์แชร์ PO/RI/PAY ----
const PURCHASE_PATHS = ['/purchases', '/purchases/orders', '/payments', '/expenses', '/reports/purchase-tax'];
export async function savePurchaseTaxInvoice(f: FormData): Promise<void> {
  const d: Record<string, string | undefined> = {};
  for (const k of ['invoice_no', 'invoice_date', 'vat_form', 'vendor_name', 'vendor_tax_id', 'branch', 'base_amount', 'vat_amount']) d[k] = str(f, k);
  await run(call('select set_purchase_tax_invoice($1,$2,$3::jsonb)', str(f, 'doc_type'), str(f, 'doc_id'), JSON.stringify(d)), PURCHASE_PATHS, 'expenses.write');
}
export const clearPurchaseTaxInvoice = async (type: string, id: string) =>
  run(call('select clear_purchase_tax_invoice($1,$2)', type, id), PURCHASE_PATHS, 'expenses.write');

export async function createStandaloneWht(p: { date: string; contact: string; form: string; category: string; lines: { income_type: string; rate?: number | null; amount: number; vat_mode?: string; wht?: number }[] }) {
  return run(call('select create_standalone_wht($1::date,$2,$3,$4::jsonb,$5)', p.date, p.contact, p.form, JSON.stringify(p.lines), p.category), ['/wht'], 'wht.write');
}
export const cancelWhtCert = async (id: string) => run(call('select cancel_wht_cert($1)', id), ['/wht'], 'wht.write');

export const sharePurchaseDoc = async (kind: string, id: string) => run(call('select ensure_purchase_share_token($1,$2)', kind, id), PURCHASE_PATHS, 'expenses.write');
export const unsharePurchaseDoc = async (kind: string, id: string) => run(call('select revoke_purchase_share_token($1,$2)', kind, id), PURCHASE_PATHS, 'expenses.write');

// ---- โมดูลสินค้า/สต็อก (M26) ----
const STK = ['/products', '/stock', '/stock/transfers', '/stock/warehouses', '/stock/low'];
export type ProductInput = { kind: string; name: string; code: string; category: string; unit: string; barcode: string; sale: number; buy: number;
  block: boolean; units: { unit: string; factor: number; sale: number; buy: number; barcode: string }[]; open?: { date: string; qty: number; cost: number } | null;
  description?: string; saleVat?: string; buyVat?: string; goodsType?: string; lowMode?: 'default' | 'custom'; lowItems?: { warehouse_id: string; min_qty: number }[] };
export async function createProductFull(p: ProductInput): Promise<Result & { id?: string }> {
  let newId: string | undefined;
  const res = await run(async () => {
    if (!p.name?.trim() || !p.code?.trim()) throw new Error('ต้องระบุชื่อและรหัสสินค้า');
    if (!p.unit?.trim()) throw new Error('ต้องระบุหน่วยสินค้าหลัก');
    const db = await getDb();
    const [r] = await db.q<any>(`insert into products(code,name,kind,base_unit,sale_price,purchase_price,category,barcode,block_negative,description,sale_vat_mode,purchase_vat_mode,goods_type)
      values ($1,$2,$3,$4,$5,$6,nullif($7,''),nullif($8,''),$9,nullif($10,''),$11,$12,$13) returning id`,
      [p.code.trim(), p.name.trim(), p.kind, p.unit.trim(), p.sale || 0, p.buy || 0, p.category?.trim() ?? '', p.barcode?.trim() ?? '', p.kind === 'goods_stock' && !!p.block,
        p.description ?? '', p.saleVat || 'exclusive', p.kind === 'service' ? 'exclusive' : p.buyVat || 'exclusive', p.kind === 'goods_nostock' ? p.goodsType || 'for_sale' : 'for_sale']);
    newId = r.id;
    for (const u of p.units ?? []) {
      if (!u.unit?.trim() || !(u.factor > 0)) throw new Error('หน่วยอื่นต้องมีชื่อและอัตราแปลงมากกว่า 0');
      await db.q('insert into product_units(product_id,unit,factor,sale_price,purchase_price,barcode) values ($1,$2,$3,$4,$5,nullif($6,\'\'))', [r.id, u.unit.trim(), u.factor, u.sale || 0, u.buy || 0, u.barcode ?? '']);
    }
    if (p.open && p.kind === 'goods_stock' && p.open.qty > 0) await db.q('select set_opening_stock($1,$2::date,$3,$4)', [r.id, p.open.date, p.open.qty, p.open.cost]);
    if (p.kind === 'goods_stock' && p.lowMode === 'custom') await db.q('select set_product_low_stock($1,$2,$3::jsonb)', [r.id, 'custom', JSON.stringify(p.lowItems ?? [])]);
  }, STK.concat('/sales'), 'master.write');
  return { ...res, id: newId };
}
export async function adjustStock(p: { product: string; date: string; wh: string; dir: 'in' | 'out'; reason: string; qty: number; cost?: number | null; note?: string }) {
  return run(call('select adjust_stock($1::date,$2,$3,$4,$5,$6,$7,$8)', p.date, p.product, p.wh, p.dir, p.reason, p.qty, p.cost ?? null, p.note ?? ''), STK, 'master.write');
}
export async function deleteAdjustment(id: string) { return run(call('select delete_stock_adjustment($1)', id), STK, 'master.write'); }
export async function createTransfer(p: { date: string; from: string; to: string; lines: { product_id: string; qty: number }[] }) {
  return run(async () => {
    if (p.from === p.to) throw new Error('คลังต้นทางและปลายทางต้องไม่ใช่คลังเดียวกัน');
    if (!p.lines.length) throw new Error('ต้องมีรายการสินค้าอย่างน้อย 1 รายการ');
    await (await getDb()).q('select create_transfer($1::date,$2,$3,$4::jsonb)', [p.date, p.from, p.to, JSON.stringify(p.lines)]);
  }, STK, 'master.write');
}
export async function receiveTransfer(id: string) { return run(call('select receive_transfer($1)', id), STK, 'master.write'); }
export async function resetTransfer(id: string) { return run(call('select reset_transfer($1)', id), STK, 'master.write'); }
export async function cancelTransfer(id: string) { return run(call('select cancel_transfer($1)', id), STK, 'master.write'); }
export async function saveWarehouse(p: { id?: string; name: string; code: string; purpose: string; address: string; postal: string; contact: string; email: string; phone: string; low?: number | null }) {
  return run(async () => {
    if (!p.name?.trim()) throw new Error('ต้องระบุชื่อคลังสินค้า');
    if (!p.purpose) throw new Error('ต้องเลือกจุดประสงค์การใช้งาน');
    const db = await getDb();
    const code = p.code.trim() || `W${Date.now().toString().slice(-6)}`;
    const id = p.id ?? (await db.q<any>('select create_warehouse($1,$2,$3) id', [code, p.name.trim(), p.purpose]))[0].id;
    await db.q('select update_warehouse($1,$2,$3,$4,$5,$6,$7,$8,$9)', [id, p.name.trim(), code, p.purpose, p.address, p.postal, p.contact, p.email, p.phone]);
    if (p.low !== undefined) await db.q('update warehouses set low_stock_min = $2 where id = $1', [id, p.low]);
  }, STK, 'master.write');
}
export async function setMainWarehouse(id: string) { return run(call('select set_main_warehouse($1)', id), STK, 'master.write'); }
export async function setLowStockMin(id: string, min: number | null) {
  return run(call('update warehouses set low_stock_min = $2 where id = $1', id, min), STK, 'master.write');
}

// ---- M26.2: แก้/ลบ/ปิดใช้งานสินค้า · ลบคลัง · ตั้งค่าสต็อก ----
export async function updateProductFull(id: string, p: ProductInput) {
  return run(async () => {
    if (!p.name?.trim()) throw new Error('ต้องระบุชื่อสินค้า');
    if (!p.unit?.trim()) throw new Error('ต้องระบุหน่วยสินค้าหลัก');
    for (const u of p.units ?? []) if (!u.unit?.trim() || !(u.factor > 0)) throw new Error('หน่วยอื่นต้องมีชื่อและอัตราแปลงมากกว่า 0');
    await (await getDb()).q('select update_product($1, $2::jsonb)', [id, JSON.stringify({ kind: p.kind, name: p.name.trim(), code: p.code, category: p.category, base_unit: p.unit.trim(), barcode: p.barcode,
      sale_price: p.sale || 0, purchase_price: p.buy || 0, block_negative: p.kind === 'goods_stock' && !!p.block,
      description: p.description ?? '', sale_vat_mode: p.saleVat || 'exclusive', purchase_vat_mode: p.kind === 'service' ? 'exclusive' : p.buyVat || 'exclusive', goods_type: p.kind === 'goods_nostock' ? p.goodsType || 'for_sale' : 'for_sale',
      units: (p.units ?? []).map(u => ({ unit: u.unit.trim(), factor: u.factor, sale_price: u.sale || 0, purchase_price: u.buy || 0, barcode: u.barcode })) })]);
    await (await getDb()).q('select set_product_low_stock($1,$2,$3::jsonb)', [id, p.kind === 'goods_stock' ? p.lowMode ?? 'default' : 'default', JSON.stringify(p.lowItems ?? [])]);
  }, STK.concat('/sales'), 'master.write');
}
export async function deleteProductImage(id: string) { return run(call('select delete_product_image($1)', id), STK, 'master.write'); }
export async function setProductImageOrder(product: string, ids: string[]) { return run(call('select set_product_image_order($1, $2::uuid[])', product, ids), STK.concat(`/products/${product}`), 'master.write'); }
export async function deleteProduct(id: string) { return run(call('select delete_product($1)', id), STK, 'master.write'); }
export async function setProductActive(id: string, active: boolean) { return run(call('select set_product_active($1,$2)', id, active), STK, 'master.write'); }
export async function deleteWarehouse(id: string) { return run(call('select delete_warehouse($1)', id), STK, 'master.write'); }
export async function saveStockSettings(f: FormData): Promise<void> {
  await run(call('select set_stock_settings($1,$2)', String(f.get('negative_sales') ?? 'warn'), f.get('low_stock_enabled') === '1'), STK.concat('/sales/new'), 'master.write');
}

// ---- M26.3: นำเข้าสินค้าจากไฟล์ / ค้นหาแนะนำ ----
export async function importProducts(p: { file: string; wh: string | null; rows: unknown[][]; map: Record<string, number> }) {
  return run(async () => {
    const { validateImport, fillCodes } = await import('./product-import');
    const db = await getDb();
    const existing = new Set((await db.q<any>('select code from products')).map(r => r.code as string));
    const v = validateImport(p.rows, p.map as any, existing);
    if (v.issues.length) throw new Error(`ไฟล์ยังมีข้อผิดพลาด ${v.issues.length} จุด — แก้ไขไฟล์แล้วนำเข้าใหม่`);
    const items = fillCodes(v.items, existing);
    await db.q('select import_products($1,$2,$3::jsonb)', [p.file, p.wh || null, JSON.stringify(items)]);
  }, STK.concat('/products/import'), 'master.write');
}
export async function deleteImportBatch(id: string) { return run(call('select delete_import_batch($1)', id), STK.concat('/products/import'), 'master.write'); }
/** ค้นหาแนะนำ (ชื่อ/รหัส/บาร์โค้ด) สำหรับช่องค้นหาหน้ารายการสินค้า */
export async function suggestProducts(q: string, wh = ''): Promise<{ id: string; code: string; name: string; onhand: number | null; unit: string }[]> {
  const u = await currentUser(); if (!u || !can(u.role, 'master.read') || !q.trim()) return [];
  const { productQuery } = await import('./product-list');
  return (await productQuery(await getDb(), { q: q.trim(), wh, limit: 8 })).map(r => ({ id: r.id, code: r.code, name: r.name, onhand: r.onhand == null ? null : Number(r.onhand), unit: r.base_unit }));
}

// ---- M27.1: สมุดรายวัน / JV ----
export type JvInput = { date: string; contact_id?: string; ref_no?: string; memo?: string; note?: string; lines: { account: string; debit?: number; credit?: number; desc?: string }[] };
export async function createJv(p: JvInput, draftId?: string | null): Promise<Result & { id?: string }> {
  let id: string | undefined;
  const r = await run(async () => { id = (await (await getDb()).q<any>('select create_jv($1::jsonb, $2) id', [JSON.stringify(p), draftId ?? null]))[0].id; }, ['/journals', '/ledger/transactions', '/reports/trial-balance', '/reports/pnl'], 'journal.write');
  return { ...r, id };
}
export async function saveJvDraft(p: JvInput, draftId?: string | null): Promise<Result & { id?: string }> {
  let id: string | undefined;
  const r = await run(async () => { id = (await (await getDb()).q<any>('select save_jv_draft($1, $2::jsonb) id', [draftId ?? null, JSON.stringify(p)]))[0].id; }, ['/journals'], 'journal.write');
  return { ...r, id };
}
export async function deleteJvDraft(id: string) { return run(call('select delete_jv_draft($1)', id), ['/journals'], 'journal.write'); }
// กลับรายการได้เฉพาะ JV ที่บันทึกมือ — ใบสำคัญที่ระบบสร้างจากเอกสารต้องยกเลิกที่เอกสารต้นทาง (กันบัญชีไม่ตรงกับเอกสาร)
export async function reverseJv(id: string) {
  return run(async () => {
    const db = await getDb();
    const [v] = await db.q<any>('select source_type from journal_vouchers where id = $1', [id]);
    if (!v) throw new Error('ไม่พบใบสำคัญ');
    if (v.source_type !== 'MANUAL') throw new Error('ใบสำคัญนี้ระบบสร้างจากเอกสาร — ยกเลิกที่เอกสารต้นทาง ไม่ใช่ที่สมุดรายวัน');
    await db.q('select reverse_voucher($1)', [id]);
  }, ['/journals', '/ledger/transactions', '/reports/trial-balance', '/reports/pnl'], 'journal.write');
}

// ===== M27.3 ผังบัญชี · ยอดเริ่มต้น · ล็อกงวด =====
const ACC_PATHS = ['/accounts', '/settings/opening-balance', '/settings/lock', '/reports/trial-balance', '/reports/pnl', '/reports/balance-sheet'];
export async function createAccount(p: { code: string; name: string; description?: string }) {
  return run(call('select create_account($1,$2,$3)', p.code, p.name, p.description ?? null), ACC_PATHS, 'accounts.write');
}
export async function updateAccount(p: { id: string; name: string; description?: string; active: boolean }) {
  return run(call('select update_account($1,$2,$3,$4)', p.id, p.name, p.description ?? null, p.active), ACC_PATHS, 'accounts.write');
}
export async function saveOpeningBalance(date: string, lines: { account: string; debit?: number; credit?: number }[]) {
  return run(call('select set_opening_balance($1::date,$2::jsonb)', date, JSON.stringify(lines)), [...ACC_PATHS, '/journals', '/ledger/transactions'], 'accounts.write');
}
export async function lockPeriod(from: string, to: string, reason: string) {
  return run(call('select lock_period($1::date,$2::date,$3)', from, to, reason), ACC_PATHS, 'accounts.write');
}
export async function releasePeriodLock(id: string) { return run(call('select release_period_lock($1)', id), ACC_PATHS, 'accounts.write'); }

// ===== M27.4 ปิดบัญชีรายได้/ค่าใช้จ่ายสิ้นปี =====
export async function closeYear(year: number) {
  return run(call('select close_year($1::int)', year), [...ACC_PATHS, '/settings/close-year', '/journals', '/ledger/transactions'], 'accounts.write');
}
export async function resetYearClose(year: number) {
  return run(call('select reset_year_close($1::int)', year), [...ACC_PATHS, '/settings/close-year', '/journals', '/ledger/transactions'], 'accounts.write');
}

// ===== M27.5 เตรียมแบบภาษีรายเดือน (ภ.พ.30) =====
const TAX_PATHS = ['/tax/filings', '/reports/purchase-tax', '/reports/sales-tax', '/journals', '/ledger/transactions', '/reports/trial-balance', '/reports/balance-sheet'];
export async function filePp30(month: string) { return run(call('select file_pp30($1::date)', `${month}-01`), TAX_PATHS, 'accounts.write'); }
export async function payPp30(id: string, date: string, account: string) { return run(call('select pay_pp30($1,$2::date,$3)', id, date, account), TAX_PATHS, 'accounts.write'); }
export async function resetPp30Payment(id: string) { return run(call('select reset_pp30_payment($1)', id), TAX_PATHS, 'accounts.write'); }
export async function setPp30Refund(id: string, recorded: boolean) { return run(call('select set_pp30_refund($1,$2)', id, recorded), TAX_PATHS, 'accounts.write'); }
export async function deletePp30(id: string) { return run(call('select delete_pp30($1)', id), TAX_PATHS, 'accounts.write'); }

// ===== M27.5 จัดการเอกสารภาษีซื้อ (สถานะใบกำกับภาษีต่อเอกสาร) =====
export async function setPurchaseVatStatus(type: string, id: string, status: string, inv?: { invoice_no?: string; invoice_date?: string }) {
  return run(call('select set_purchase_vat_status($1,$2,$3,$4::jsonb)', type, id, status, JSON.stringify(inv ?? {})),
    ['/tax/purchase-vat', '/reports/purchase-tax', '/expenses', '/purchases'], 'accounts.write');
}
