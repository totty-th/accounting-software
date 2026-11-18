// M65 ใบวางบิลรวม: ข้อมูลสำหรับพิมพ์ (ใช้แบบเดียวกับใบเสร็จรวม) และแผงรายการในหน้ารายละเอียด
import { getDb } from './db';
import type { ReceiptView } from '@/components/ReceiptSheet';

const d10 = (x: any) => (x ? (x instanceof Date ? x.toISOString() : String(x)).slice(0, 10) : null);

export type CombinedItem = { line_no: number; doc_no: string; doc_type: string; doc_date: string | null; due_date: string | null; doc_total: number; wht: number; amount: number };

export async function combinedItems(id: string): Promise<CombinedItem[]> {
  const rows = await (await getDb()).q<any>(`select i.line_no, d.doc_no, d.doc_type, d.doc_date, d.due_date, i.doc_total, i.wht, i.amount
    from billing_note_items i join sales_docs d on d.id = i.invoice_id where i.billing_id = $1 order by i.line_no nulls last, d.doc_no`, [id]);
  return rows.map((r, n) => ({ line_no: Number(r.line_no ?? n + 1), doc_no: r.doc_no, doc_type: r.doc_type, doc_date: d10(r.doc_date), due_date: d10(r.due_date),
    doc_total: Number(r.doc_total ?? 0), wht: Number(r.wht ?? 0), amount: Number(r.amount ?? 0) }));
}

/** แปลงใบวางบิลรวมเป็นรูปแบบเดียวกับใบเสร็จรวม เพื่อใช้ buildReceiptPdf */
export async function combinedPdfView(v: { doc: any; contact: any; company: any }): Promise<ReceiptView> {
  const items = await combinedItems(v.doc.id);
  const vat = Number(v.doc.vat), total = Number(v.doc.total);
  const wht = Math.round(items.reduce((a, i) => a + i.wht, 0) * 100) / 100;
  return {
    receipt: { id: v.doc.id, receipt_no: v.doc.doc_no, kind: 'combined', receipt_date: d10(v.doc.doc_date)!, status: v.doc.status, amount: total, wht,
      collected_date: null, vat_rate: vat ? Number(v.doc.vat_rate ?? 7) : null, vat, base: Math.round((total - vat) * 100) / 100 },
    contact: { name: v.contact.name, address: v.contact.address, tax_id: v.contact.tax_id },
    company: v.company ? { name: v.company.name, address: v.company.address, tax_id: v.company.tax_id } : null,
    items: items.map(i => ({ line_no: i.line_no, doc_no: i.doc_no, doc_date: i.doc_date, due_date: i.due_date, doc_total: i.doc_total, description: null, amount: i.amount, wht: i.wht })),
    payments: [],
  };
}
