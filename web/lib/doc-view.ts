import { getDb } from './db';

export interface DocView {
  doc: { id: string; doc_type: string; doc_no: string; doc_date: string; due_date: string | null; status: string; price_mode: string;
    vat_rate: string | number; subtotal: string | number; vat: string | number; total: string | number; reason: string | null;
    is_deposit: boolean; deposit_net: string | number; deposit_vat: string | number; wht_rate?: string | number; salesperson?: string | null };
  contact: { id: string; name: string; address: string | null; tax_id: string | null; credit_days: number };
  company: { name: string; address: string | null; tax_id: string | null } | null;
  lines: { line_no: number; description: string; item_kind: string; qty: string | number; unit_price: string | number; amount: string | number }[];
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
    v.doc.salesperson = (await db.q<{ n: string | null }>(
      'select u.display_name as n from sales_docs d left join app_users u on u.id = d.created_by where d.id = $1', [id]))[0]?.n ?? null;
    return v;
  } catch { return null; }
}
export async function loadViewByToken(token: string): Promise<DocView | null> {
  if (!/^[0-9a-f]{26}$/.test(token)) return null;
  const r = (await (await getDb()).q<{ id: string | null }>('select sales_doc_by_token($1) as id', [token]))[0];
  return r?.id ? loadView(r.id) : null;
}

// ชื่อเอกสารและสีประจำชนิด (ใช้ทั้งหน้าจอ พิมพ์ และ PDF)
export const DOC_TITLE: Record<string, { title: string; color: string; rgb: [number, number, number] }> = {
  QT: { title: 'ใบเสนอราคา', color: '#e8870e', rgb: [0.91, 0.53, 0.06] },
  INV: { title: 'ใบแจ้งหนี้/ใบกำกับภาษี', color: '#1f6fb5', rgb: [0.12, 0.44, 0.71] },
  CA: { title: 'ใบกำกับภาษี/ใบเสร็จรับเงิน (ขายสด)', color: '#0f8f7a', rgb: [0.06, 0.56, 0.48] },
  BL: { title: 'ใบวางบิล', color: '#5b8a1f', rgb: [0.36, 0.54, 0.12] },
  CN: { title: 'ใบลดหนี้/ใบกำกับภาษี', color: '#c0392b', rgb: [0.75, 0.22, 0.17] },
  DN: { title: 'ใบเพิ่มหนี้/ใบกำกับภาษี', color: '#7b4fb5', rgb: [0.48, 0.31, 0.71] },
};
export const shareBase = () => process.env.NEXT_PUBLIC_BASE_URL ?? '';
