import { apiUser } from '@/lib/auth';
import { getDb, today } from '@/lib/db';
import { companyOf } from '@/lib/fa-xlsx';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const ST: Record<string, string> = { draft: 'ร่าง', pending: 'รอดำเนินการ', approved: 'อนุมัติ', paid: 'ชำระเงินแล้ว', partial: 'ชำระบางส่วน', cancelled: 'ยกเลิก', rejected: 'ไม่อนุมัติ' };
const q = (v: unknown) => { const s = String(v ?? ''); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const dmy = (d: unknown) => { const s = d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10); return s.split('-').reverse().join('/'); };
// GET /reports/projects/:id/csv?from=&to= → CSV "รายงานตามโปรเจ็ค" (REA FA 1-11-2026: UTF-8 BOM, CRLF, ส่วนเอกสารค่าใช้จ่าย ยอด = ก่อน VAT)
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const au = await apiUser(['reports.read']); if (au instanceof Response) return au;
  const u = new URL(req.url), iso = (k: string) => (/^\d{4}-\d{2}-\d{2}$/.test(u.searchParams.get(k) ?? '') ? u.searchParams.get(k)! : today());
  const from = iso('from'), to = iso('to');
  const db = await getDb();
  const [p] = await db.q<any>(`select name from projects where id = $1`, [params.id]); if (!p) return new Response('ไม่พบโปรเจ็ค', { status: 404 });
  const co = await companyOf(db);
  const exp = await db.q<any>(`select * from (
      select e.exp_date dt, e.exp_no no, coalesce(c.business_name, c.contact_name) who, e.due_date due, (select l.category from expense_lines l where l.expense_id = e.id order by l.line_no limit 1) cat, e.subtotal amt, e.status
        from expenses e left join contacts c on c.id = e.contact_id where e.project = $1
      union all
      select g.ri_date, g.ri_no, coalesce(c.business_name, c.contact_name), g.due_date, null, g.subtotal, g.status
        from goods_receipts g left join contacts c on c.id = g.contact_id where g.project = $1) x
    where dt between $2::date and $3::date order by dt, no`, [p.name, from, to]);
  const rev = await db.q<any>(`select d.doc_date dt, d.doc_no no, coalesce(c.business_name, c.contact_name) who, d.due_date due, case when d.doc_type = 'CN' then -d.subtotal else d.subtotal end amt, d.status
      from sales_docs d left join contacts c on c.id = d.contact_id where d.project = $1 and d.doc_type in ('INV','CA','CN') and d.doc_date between $2::date and $3::date order by d.doc_date, d.doc_no`, [p.name, from, to]);
  const L: string[][] = [['รายงานตามโปรเจ็ค'], ['ชื่อบริษัท', co.name], ['เลขผู้เสียภาษี :', co.tax_id ?? ''], ['ชื่อโปรเจ็ค', p.name], []];
  const sec = (title: string, rows: any[], cat: boolean, label: string) => {
    if (!rows.length) return;
    L.push([title, 'ลำดับที่', 'วันที่', 'เลขที่เอกสาร', 'ชื่อลูกค้า/ชื่อผู้จำหน่าย', 'วันครบกำหนด', cat ? 'ประเภทค่าใช้จ่าย' : '', 'ยอดรวมสุทธิ', 'สถานะ']);
    let t = 0; rows.forEach((r, i) => { if (!['cancelled', 'rejected'].includes(r.status)) t += Number(r.amt); L.push(['', String(i + 1), dmy(r.dt), r.no, r.who ?? '', r.due ? dmy(r.due) : '', r.cat ?? '', Number(r.amt).toFixed(2), ST[r.status] ?? r.status]); });
    L.push(['', '', '', '', '', '', label, t.toFixed(2), '']); L.push([]);
  };
  sec('เอกสารค่าใช้จ่าย', exp, true, 'ค่าใช้จ่ายรวม');
  sec('เอกสารรายได้', rev, false, 'รายได้รวม');
  const body = '﻿' + L.map(r => r.map(q).join(',')).join('\r\n');
  return new Response(body, { headers: { 'content-type': 'text/csv; charset=utf-8',
    'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`${co.name.trim()}_ProjectReport_${dmy(from).replace(/\//g, '-')}_${dmy(to).replace(/\//g, '-')}`)}.csv` } });
}
