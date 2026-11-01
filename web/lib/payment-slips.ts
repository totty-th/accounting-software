import type { Db } from './db';
import type { SlipState } from './slip-state';

export interface SlipRow { id: string; pay_no: string; pay_date: any; due_date: any; status: string; receipt_received: boolean; state: SlipState;
  vendors: string[]; gross: number; wht: number; net: number; docs: number; share_token: string | null }

/** รายการใบเตรียมจ่าย พร้อมสถานะแบบต้นแบบ: รอดำเนินการ/ชำระเงินแล้ว/รับใบเสร็จแล้ว/ยกเลิก */
export async function slipRows(db: Db): Promise<{ rows: SlipRow[]; items: any[] }> {
  const slips = await db.q(`select * from payment_slips order by pay_date desc, pay_no desc`);
  const items = await db.q(`select x.slip_id, x.line_no, x.doc_type, x.doc_id, i.contact_id, i.doc_no, i.doc_date, i.due_date, i.gross, i.wht, i.net, i.paid,
      c.business_name, c.contact_name
    from payment_slip_items x cross join lateral slip_doc_info(x.doc_type, x.doc_id) i join contacts c on c.id=i.contact_id
    order by x.slip_id, x.line_no`);
  const rows = slips.map((s: any): SlipRow => {
    const its = items.filter((i: any) => i.slip_id === s.id);
    const state: SlipState = s.status === 'cancelled' ? 'cancelled'
      : its.length && its.every((i: any) => i.paid) ? (s.receipt_received ? 'received' : 'paid') : 'pending';
    const names = [...new Set(its.map((i: any) => (i.business_name || i.contact_name) as string))];
    const sum = (k: string) => Math.round(its.reduce((a: number, i: any) => a + Number(i[k]) * 100, 0)) / 100;
    return { id: s.id, pay_no: s.pay_no, pay_date: s.pay_date, due_date: s.due_date, status: s.status, receipt_received: s.receipt_received, state,
      vendors: names, gross: sum('gross'), wht: sum('wht'), net: sum('net'), docs: its.length, share_token: s.share_token ?? null };
  });
  return { rows, items };
}
