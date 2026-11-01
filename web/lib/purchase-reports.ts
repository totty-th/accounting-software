import { getDb } from './db';
import { pgArr } from './report-filter';

export const PO_LABEL: Record<string, string> = { pending: 'รออนุมัติ', approved: 'อนุมัติ', converted: 'ดำเนินการแล้ว', rejected: 'ไม่อนุมัติ', partial: 'แบ่งจ่าย', cancelled: 'ยกเลิก' };
export const PO_TONE: Record<string, string> = { pending: '#797e93', approved: '#00c875', converted: '#0086c0', rejected: '#e2445c', partial: '#a25ddc', cancelled: '#797e93' };
// ตัวกรองสถานะใบสั่งซื้อ (ตาม FA: รออนุมัติ / อนุมัติ / ดำเนินการแล้ว / ไม่อนุมัติ / แบ่งจ่าย) · ไม่เลือก = ทุกสถานะที่ไม่ยกเลิก
export const PO_BUCKETS: Record<string, string[]> = { pending: ['pending'], approved: ['approved'], converted: ['converted'], rejected: ['rejected'], partial: ['partial'] };
export const PO_OPTS: [string, string][] = [['pending', 'รออนุมัติ'], ['approved', 'อนุมัติ'], ['converted', 'ดำเนินการแล้ว'], ['rejected', 'ไม่อนุมัติ'], ['partial', 'แบ่งจ่าย']];
export const branchText = (c: { tax_id?: string | null; branch_code?: string | null; branch_name?: string | null }) =>
  c.branch_code ? `สาขา ${c.branch_code}${c.branch_name ? ' ' + c.branch_name : ''}` : 'สำนักงานใหญ่';

export async function poRows(range: [string, string] | null, statuses: string[]) {
  return (await getDb()).q<any>(`select po.*, c.business_name, c.contact_name, c.tax_id, c.branch_code, c.branch_name,
      (select string_agg(g.ri_no, ',' order by g.ri_no) from goods_receipts g where g.po_id = po.id) ris
    from purchase_orders po join contacts c on c.id = po.contact_id
    where ($1::date is null or po.po_date >= $1::date) and ($2::date is null or po.po_date <= $2::date)
      and (cardinality($3::text[]) = 0 and po.status <> 'cancelled' or po.status = any($3::text[]))
    order by po.po_date desc, po.po_no desc`, [range?.[0] ?? null, range?.[1] ?? null, pgArr(statuses)]);
}

export interface RiProductFilter { kind?: string; wh?: string; product?: string }
/** บรรทัดใบรับสินค้า (ไม่รวมไม่อนุมัติ/ยกเลิก) พร้อมข้อมูลสินค้า/คลัง/ผู้จำหน่าย ตามตัวกรองของรายงาน "ใบรับสินค้าแยกตามสินค้า" */
export async function riLines(range: [string, string] | null, f: RiProductFilter) {
  return (await getDb()).q<any>(`select l.*, g.ri_no, g.ri_date, g.status, g.id gid, p.code pcode, p.name pname, p.kind pkind, p.category pcat, coalesce(nullif(l.unit, ''), p.base_unit) unit_name,
      w.name wh_name, c.business_name, c.contact_name
    from goods_receipt_lines l join goods_receipts g on g.id = l.ri_id join products p on p.id = l.product_id
      join warehouses w on w.id = l.warehouse_id join contacts c on c.id = g.contact_id
    where g.status not in ('rejected','cancelled') and ($1::date is null or g.ri_date >= $1::date) and ($2::date is null or g.ri_date <= $2::date)
      and ($3::text = '' or p.kind = $3) and ($4::text = '' or l.warehouse_id::text = $4) and ($5::text = '' or l.product_id::text = $5)
    order by p.code, g.ri_date desc, g.ri_no desc, l.line_no`, [range?.[0] ?? null, range?.[1] ?? null, f.kind ?? '', f.wh ?? '', f.product ?? '']);
}
export interface ProdGroup { id: string; code: string; name: string; unit: string; cat: string; kind: string; qty: number; net: number; vat: number; rows: any[] }
export function groupByProduct(lines: any[]): ProdGroup[] {
  const m = new Map<string, ProdGroup>();
  for (const l of lines) {
    const g: ProdGroup = m.get(l.product_id) ?? { id: l.product_id, code: l.pcode ?? '', name: l.pname, unit: l.unit_name ?? '', cat: l.pcat ?? '', kind: l.pkind, qty: 0, net: 0, vat: 0, rows: [] };
    g.qty += Number(l.qty); g.net += Number(l.net); g.vat += Number(l.vat); g.rows.push(l); m.set(l.product_id, g);
  }
  return [...m.values()];
}
