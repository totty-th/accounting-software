import { getDb } from '@/lib/db';

export interface Lot { ref: string; qty: number; unit_price: number; value: number }
export interface InvRow { code: string; name: string; unit: string; qty: number; avg: number; value: number; lots: Lot[] }

/** สรุปสินค้าคงเหลือ ณ วันที่ + ชั้นสินค้า (lot) ที่ยังเหลือ: นำรับเข้า (RI/ยอดตั้งต้น/อื่น ๆ) มาตัดออกแบบเข้าก่อน-ออกก่อน
 *  ใช้แสดงผลแบบละเอียดเท่านั้น — มูลค่ารวมของสินค้ายึดตามฟังก์ชัน inventory_summary (ต้นทุนเฉลี่ย) */
export async function inventoryRows(date: string, wh: string | null, withLots: boolean): Promise<InvRow[]> {
  const db = await getDb();
  const rows = await db.q<any>(`select p.id, s.code, s.name, s.unit, s.qty::float8 q, s.avg_cost::float8 avg, s.value::float8 v
    from inventory_summary($1::date,$2::uuid) s join products p on p.code = s.code`, [date, wh]);
  const out: InvRow[] = rows.map((r: any) => ({ code: r.code, name: r.name, unit: r.unit, qty: r.q, avg: r.avg, value: r.v, lots: [] }));
  if (!withLots || rows.length === 0) return out;
  const mv = await db.q<any>(`select product_id, doc_type, coalesce(doc_no,'') doc_no, qty_in::float8 qi, qty_out::float8 qo, unit_cost::float8 uc, value::float8 v
    from stock_movements where voided_at is null and move_date <= $1::date and ($2::uuid is null or warehouse_id = $2::uuid)
    order by move_date, seq`, [date, wh]);
  const by = new Map<string, any[]>(); for (const m of mv) { (by.get(m.product_id) ?? by.set(m.product_id, []).get(m.product_id)!).push(m); }
  rows.forEach((r: any, i: number) => {
    const q: Lot[] = [];
    for (const m of by.get(r.id) ?? []) {
      if (m.qi > 0) q.push({ ref: m.doc_type === 'OPEN' ? 'ยอดตั้งต้น' : m.doc_no, qty: m.qi, unit_price: m.uc ?? (m.v / m.qi), value: 0 });
      let o = m.qo;
      while (o > 1e-9 && q.length) { const t = Math.min(o, q[0].qty); q[0].qty -= t; o -= t; if (q[0].qty <= 1e-9) q.shift(); }
    }
    out[i].lots = r.q > 0 ? q.filter(l => l.qty > 1e-9).map(l => ({ ...l, value: Math.round(l.qty * l.unit_price * 100) / 100 })) : [];
  });
  return out;
}
