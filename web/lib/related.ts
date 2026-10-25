// "เอกสารที่เกี่ยวข้อง" กลางทุกหน้ารายการ/รายงาน (แบบ FA: ไอคอนข้างเลขที่เอกสาร ชี้เมาส์แล้วขึ้นรายการ)
// ไอคอนโผล่เฉพาะเอกสารที่มีเอกสารเชื่อมโยงเท่านั้น
type Db = { q: <T = any>(sql: string, a?: unknown[]) => Promise<T[]> };
export type Rel = { no: string; kind: string; href: string };
export type RelKind = 'sales' | 'receipt' | 'exp' | 'ri' | 'po';

const SQL: Record<RelKind, string> = {
  // เอกสารขาย: เอกสารอ้างอิง (ต้นทาง) + เอกสารที่ออกต่อ + ใบเสร็จ + ใบวางบิล
  sales: `
    select d.id, r.doc_no no, r.doc_type kind, '/sales/' || r.doc_no href from sales_docs d join sales_docs r on r.id = d.ref_doc_id
    union all select d.id, ch.doc_no, ch.doc_type, '/sales/' || ch.doc_no from sales_docs d join sales_docs ch on ch.ref_doc_id = d.id
    union all select ri.doc_id, rc.receipt_no, 'RE', '/receipts/' || rc.receipt_no from receipt_items ri join receipts rc on rc.id = ri.receipt_id where rc.status <> 'cancelled'
    union all select b.invoice_id, bl.doc_no, 'BL', '/sales/' || bl.doc_no from billing_note_items b join sales_docs bl on bl.id = b.billing_id where bl.status <> 'cancelled'
    union all select b.billing_id, i.doc_no, i.doc_type, '/sales/' || i.doc_no from billing_note_items b join sales_docs i on i.id = b.invoice_id`,
  // ใบเสร็จ: เอกสารที่รับชำระ (INV/DN/CN)
  receipt: `select ri.receipt_id id, d.doc_no no, d.doc_type kind, '/sales/' || d.doc_no href from receipt_items ri join sales_docs d on d.id = ri.doc_id
    union all select ri.receipt_id, c.doc_no, c.doc_type, '/sales/' || c.doc_no from receipt_items ri join sales_docs c on c.ref_doc_id = ri.doc_id and c.doc_type in ('CN','DN') and c.status <> 'cancelled'`,
  exp: `select w.expense_id id, w.cert_no no, 'WT' kind, '/wht' href from wht_certs w where w.expense_id is not null and w.status = 'active'
    union all select x.doc_id, s.pay_no, 'PAY', '/payments' from payment_slip_items x join payment_slips s on s.id = x.slip_id where s.status = 'active' and x.doc_type = 'EXP'`,
  ri: `select g.id, po.po_no, 'PO', '/purchases/orders/' || po.id from goods_receipts g join purchase_orders po on po.id = g.po_id
    union all select x.doc_id, s.pay_no, 'PAY', '/payments' from payment_slip_items x join payment_slips s on s.id = x.slip_id where s.status = 'active' and x.doc_type = 'RI'`,
  po: `select po.id, g.ri_no, 'RI', '/purchases/ri/' || g.id from purchase_orders po join goods_receipts g on g.id = po.ri_id`,
};

export async function related(db: Db, kind: RelKind, ids: string[]): Promise<Map<string, Rel[]>> {
  const m = new Map<string, Rel[]>();
  if (!ids.length) return m;
  const rows = await db.q<any>(`select x.id, x.no, x.kind, x.href from (${SQL[kind]}) x where x.id = any($1::uuid[]) order by x.no`, [`{${ids.join(',')}}`]);
  for (const r of rows) { const l = m.get(r.id) ?? []; if (!l.some(y => y.no === r.no)) l.push({ no: r.no, kind: r.kind, href: r.href }); m.set(r.id, l); }
  return m;
}
