import ExcelJS from 'exceljs';
import { apiUser } from '@/lib/auth';
import { getDb, today } from '@/lib/db';
import { periodRange } from '@/lib/period';
import { reportPeriod, pgArr, periodLabel } from '@/lib/report-filter';
import { companyOf, faSheet, faHead, faFormat, send, xDate } from '@/lib/fa-xlsx';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const CH = `case pp.method when 'cash' then 'cash' when 'transfer' then 'transfer:' || pp.bank_account_id when 'card' then 'card:' || pp.credit_card_id
  when 'petty' then 'petty:' || pp.petty_fund_id when 'cheque' then 'cheque:' || pp.bank_account_id end`;
const GROUP = `case pp.method when 'cash' then 'เงินสด' when 'transfer' then 'โอน ' || coalesce(ba.bank_name || ' ' || ba.account_no, '')
  when 'card' then 'บัตรเครดิต ' || coalesce(cc.card_name || ' ****' || cc.last4, '') when 'petty' then 'เงินสดย่อย ' || coalesce(pf.fund_name, '')
  when 'cheque' then 'เช็ค ' || coalesce(ba.bank_name || ' ' || ba.account_no, '') end`;
const KIND = { cash: 'เงินสด', transfer: 'โอน', card: 'บัตรเครดิต', petty: 'เงินสดย่อย', cheque: 'เช็ค' } as Record<string, string>;

// GET /reports/payments/export?period=&from=&to=&ch= → Excel รายงานการชำระเงิน: 4 ชีตแบบ FA (สรุปตามช่องทาง / ตามเอกสาร / ตามช่องทาง 2 แบบ)
export async function GET(req: Request) {
  const au = await apiUser(['reports.read']); if (au instanceof Response) return au;
  const u = new URL(req.url), g = (k: string) => u.searchParams.get(k) ?? undefined;
  const period = reportPeriod(g('period')), range = periodRange(period, today(), g('from'), g('to'));
  const sel = u.searchParams.getAll('ch');
  const db = await getDb();
  const rows = await db.q<any>(`select pp.doc_type, pp.doc_id, pp.line_no, pp.method, pp.pay_date, pp.amount, pp.cheque_no, pp.cheque_date, ${GROUP} grp, ${CH} key,
      d.no, d.dt, d.net, d.wht, d.slip, c.business_name, c.contact_name,
      (select coalesce(sum(p2.amount), 0) from purchase_payments p2 where p2.doc_type = pp.doc_type and p2.doc_id = pp.doc_id) doc_paid
    from purchase_payments pp
      left join bank_accounts ba on ba.id = pp.bank_account_id left join credit_cards cc on cc.id = pp.credit_card_id left join petty_funds pf on pf.id = pp.petty_fund_id
      join lateral (select e.exp_no no, e.exp_date dt, e.contact_id, e.total net, e.wht_total wht, e.status,
                           (select s.pay_no from payment_slip_items x join payment_slips s on s.id = x.slip_id where s.status = 'active' and x.doc_id = e.id limit 1) slip
                      from expenses e where pp.doc_type = 'EXP' and e.id = pp.doc_id
                    union all select g.ri_no, g.ri_date, g.contact_id, g.total, g.wht_total, g.status,
                           (select s.pay_no from payment_slip_items x join payment_slips s on s.id = x.slip_id where s.status = 'active' and x.doc_id = g.id limit 1)
                      from goods_receipts g where pp.doc_type = 'RI' and g.id = pp.doc_id) d on d.status <> 'cancelled'
      join contacts c on c.id = d.contact_id
    where ($1::date is null or pp.pay_date >= $1::date) and ($2::date is null or pp.pay_date <= $2::date)
      and (cardinality($3::text[]) = 0 or ${CH} = any($3::text[])) order by pp.method, 9, pp.pay_date, d.no`, [range?.[0] ?? null, range?.[1] ?? null, pgArr(sel)]);
  const co = await companyOf(db), pl = periodLabel(range);
  const wb = new ExcelJS.Workbook();
  const diff = (r: any) => Math.max(Number(r.net) - Number(r.wht) - Number(r.doc_paid), 0);
  const detail = (r: any) => r.method === 'cheque' ? `เลขที่ ${r.cheque_no ?? ''} ${r.cheque_date ? (r.cheque_date instanceof Date ? r.cheque_date.toISOString() : String(r.cheque_date)).slice(0, 10).split('-').reverse().join('/') : ''}` : '';

  // ชีตสรุปตามช่องทาง
  const docsSeen = new Map<string, any>(); rows.forEach(r => docsSeen.set(`${r.doc_type}:${r.doc_id}`, r));
  const sum = wb.addWorksheet('SummaryByChannel');
  sum.addRow(['สรุปยอดการชำระแยกตามประเภทช่องทาง']); sum.getCell('A1').font = { bold: true, size: 14 }; sum.addRow([]);
  sum.addRow(['สรุปยอดการชำระเงิน']).font = { bold: true };
  const docsArr = [...docsSeen.values()];
  const totDoc = docsArr.reduce((x, r) => x + Number(r.net), 0), totPaid = rows.reduce((x, r) => x + Number(r.amount), 0), totDiff = docsArr.reduce((x, r) => x + diff(r), 0);
  sum.addRow(['ยอดรวมเอกสาร', totDoc]); sum.addRow(['ยอดรวมที่ชำระเงินทั้งหมด', totPaid]); sum.addRow(['ผลต่าง', totDiff]);
  sum.addRow(['จำนวนเอกสาร', docsArr.length]); sum.addRow(['จำนวนเอกสารที่ชำระครบ', docsArr.filter(r => diff(r) <= 0).length]); sum.addRow(['จำนวนเอกสารที่มีผลต่าง', docsArr.filter(r => diff(r) > 0).length]);
  sum.addRow([]); sum.addRow(['สรุปยอดการชำระเงินตามช่องทาง', 'ยอดชำระรวม', 'จำนวนรายการ']).font = { bold: true };
  for (const [m, label] of Object.entries(KIND)) { const rs = rows.filter(r => r.method === m); if (rs.length) sum.addRow([label, rs.reduce((x, r) => x + Number(r.amount), 0), rs.length]); }
  sum.addRow(['รวมทั้งสิ้น', totPaid, rows.length]).font = { bold: true };
  sum.addRow([]); sum.addRow(['หมายเหตุ: ไม่รวมเอกสารสถานะยกเลิก']);
  faFormat(sum, [38, 18, 16], [], [2]);

  // ชีตตามเอกสาร: จัดกลุ่มตามช่องทาง
  const byDoc = faSheet(wb, 'PaymentByDocument', 'รายงานการชำระเงินตามเอกสาร', co, pl, 11);
  faHead(byDoc, ['เลขที่เอกสาร', 'วัน/เดือน/ปี', 'ชื่อผู้จำหน่าย', 'ชื่อโปรเจ็ค', 'วันที่ชำระ', 'ช่องทาง', 'รายละเอียดการชำระ', 'สกุลเงินในเอกสาร', 'อัตราแลกเปลี่ยน', 'ยอดรวมสุทธิ', 'ยอดรวมสุทธิ( บาท)', 'หัก ณ ที่จ่าย', 'ผลต่าง', 'เหตุผล', 'ยอดชำระ', 'ค่าธรรมเนียม']);
  const groups = [...new Set(rows.map(r => r.key))];
  let gNet = 0, gPaid = 0;
  for (const k of groups) {
    const rs = rows.filter(r => r.key === k);
    byDoc.addRow([rs[0].grp]).font = { bold: true };
    rs.forEach(r => byDoc.addRow([r.slip ?? r.no, xDate(r.dt), r.business_name || r.contact_name, '', xDate(r.pay_date), KIND[r.method], detail(r), 'THB', '', '', Number(r.net), Number(r.wht), diff(r), '', Number(r.amount), 0]));
    const sn = rs.reduce((x, r) => x + Number(r.net), 0), sp = rs.reduce((x, r) => x + Number(r.amount), 0); gNet += sn; gPaid += sp;
    const t = byDoc.addRow([null, null, null, null, null, null, null, null, null, 'ยอดรวม', null, null, null, null, sp, 0]); t.font = { bold: true };
    byDoc.addRow([]);
  }
  byDoc.addRow([null, null, null, null, null, null, null, null, null, 'ยอดรวมทั้งสิ้น', gNet, null, null, null, gPaid, 0]).font = { bold: true };
  faFormat(byDoc, [20, 13, 32, 16, 13, 12, 36, 12, 12, 14, 16, 14, 12, 22, 14, 12], [2, 5], [10, 11, 12, 13, 15, 16]);

  // ชีตตามช่องทาง (รวมต่อเอกสาร / รวมต่อบรรทัด — ข้อมูลเดียวกันเพราะเรายังไม่มีสกุลเงินต่างประเทศ)
  for (const name of ['PaymentByChannel(TotalPerDoc)', 'PaymentByChannel(TotalPerRow)']) {
    const ws = faSheet(wb, name, name.includes('PerDoc') ? 'รายงานการชำระเงินตามช่องทางจ่ายเงิน - สรุปยอดเต็มครั้งเดียว' : 'รายงานการชำระเงินตามช่องทางจ่ายเงิน - สรุปยอดเต็มทุกบรรทัด', co, pl, 11);
    faHead(ws, ['เลขที่เอกสาร', 'วัน/เดือน/ปี', 'ชื่อผู้จำหน่าย', 'ชื่อโปรเจ็ค', 'วันที่ชำระ', 'ยอดชำระ', 'ช่องทาง', 'รายละเอียดการชำระ', 'สกุลเงินในเอกสาร', 'อัตราแลกเปลี่ยน', 'มูลค่าตามเอกสาร', 'ยอดรวมสุทธิ( บาท)', 'หัก ณ ที่จ่าย', 'ผลต่าง', 'เหตุผล', 'ค่าธรรมเนียม']);
    rows.forEach(r => ws.addRow([r.slip ?? r.no, xDate(r.dt), r.business_name || r.contact_name, '', xDate(r.pay_date), Number(r.amount), KIND[r.method], detail(r), 'THB', 1, Number(r.net), Number(r.net), Number(r.wht), diff(r), '', 0]));
    ws.addRow([]); ws.addRow(['ยอดรวมแต่ละสกุลเงิน']).font = { bold: true }; ws.addRow(['สกุลเงิน', 'ยอดรวมสุทธิ (บาท)', 'หัก ณ ที่จ่าย']).font = { bold: true };
    ws.addRow(['THB', docsArr.reduce((x, r) => x + Number(r.net), 0), docsArr.reduce((x, r) => x + Number(r.wht), 0)]);
    faFormat(ws, [20, 13, 32, 16, 13, 14, 12, 36, 12, 12, 16, 16, 14, 12, 16, 12], [2, 5], [6, 11, 12, 13, 14]);
  }
  return send(wb, 'รายงานการชำระเงิน');
}
