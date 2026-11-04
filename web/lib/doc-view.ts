import { getDb } from './db';

export interface DocView {
  doc: { id: string; doc_type: string; doc_no: string; doc_date: string; due_date: string | null; status: string; price_mode: string;
    vat_rate: string | number; subtotal: string | number; vat: string | number; total: string | number; reason: string | null;
    is_deposit: boolean; deposit_net: string | number; deposit_vat: string | number; wht_rate?: string | number; salesperson?: string | null;
    term_mode?: string; credit_days?: number; salesperson_name?: string | null; project?: string | null; ref_no?: string | null; description?: string | null;
    show_signature?: boolean; note?: string | null; discount_total?: string | number; exempt_base?: string | number; wht_total?: string | number;
    delivery_mode?: 'pickup' | 'ship' | null; ship_name?: string | null; ship_address?: string | null; ship_phone?: string | null; carrier?: string | null; delivery_note?: string | null };
  contact: { id: string; name: string; address: string | null; tax_id: string | null; credit_days: number };
  company: { name: string; address: string | null; tax_id: string | null } | null;
  payInfo?: { kind: string; bank: string | null; account_no: string | null; account_name: string | null; branch: string | null; cheque_payee: string | null; remark: string | null; qr_img: string | null }[];
  design?: import('./doc-design').DocDesign; images?: { logo: string | null; stamp: string | null };
  lines: { line_no: number; description: string; item_kind: string; qty: string | number; unit_price: string | number; amount: string | number;
    unit?: string | null; detail?: string | null; discount?: string | number; discount_type?: string; discount_value?: string | number; vat_rate?: string | number | null; vat_exempt?: boolean; wht_rate?: string | number; wht?: string | number }[];
  ref: { id: string; doc_no: string; doc_type: string; doc_date: string; subtotal: string | number; total: string | number } | null;
  children: { id: string; doc_no: string; doc_type: string; status: string }[];
  receipts: { id: string; receipt_no: string; status: string; receipt_date: string; collected_date: string | null; amount: string | number }[];
  vouchers: { id: string; voucher_no: string }[];
}

// รับได้ทั้ง uuid และเลขที่เอกสาร (เดโมบน Vercel มีหลาย instance ที่ uuid ไม่ตรงกัน เลขที่เอกสารจึงเสถียรกว่า)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export async function loadView(key: string): Promise<DocView | null> {
  let id = key;
  if (!UUID.test(key)) {
    const r = (await (await getDb()).q<{ id: string }>('select id from sales_docs where doc_no=$1', [decodeURIComponent(key)]))[0];
    if (!r) return null;
    id = r.id;
  }
  try {
    const db = await getDb();
    const v = (await db.q<{ v: DocView }>('select sales_doc_view($1) as v', [id]))[0].v;
    // พนักงานขาย = ผู้ใช้ที่ล็อกอินสร้างเอกสาร (sales_docs.created_by) ไม่ให้เลือกเอง
    v.doc.salesperson = v.doc.salesperson_name || ((await db.q<{ n: string | null }>(
      'select u.display_name as n from sales_docs d left join app_users u on u.id = d.created_by where d.id = $1', [id]))[0]?.n ?? null);
    const { resolveDesign } = await import('./doc-design');
    v.design = resolveDesign(await db.q<any>('select scope, settings from doc_design'), v.doc.doc_type);
    const im = (await db.q<any>('select logo_img, stamp_img from company_profile limit 1'))[0];
    v.images = { logo: im?.logo_img ?? null, stamp: im?.stamp_img ?? null };
    v.payInfo = await db.q<any>('select kind, bank, account_no, account_name, branch, cheque_payee, remark, qr_img from payment_infos where is_active order by sort_no, created_at');
    return v;
  } catch { return null; }
}
export async function loadViewByToken(token: string): Promise<DocView | null> {
  if (!/^[0-9a-f]{26}$/.test(token)) return null;
  const r = (await (await getDb()).q<{ id: string | null }>('select sales_doc_by_token($1) as id', [token]))[0];
  return r?.id ? loadView(r.id) : null;
}

export { DOC_TITLE } from './doc-title';
export const shareBase = () => process.env.NEXT_PUBLIC_BASE_URL ?? '';
