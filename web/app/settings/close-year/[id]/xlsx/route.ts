import ExcelJS from 'exceljs';
import { apiUser } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { companyOf, send } from '@/lib/fa-xlsx';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const MON = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const th = (d: string) => `${d.slice(8, 10)} ${MON[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
// GET /settings/close-year/[id]/xlsx → Excel รายการปิดบัญชีรายได้และค่าใช้จ่าย (คอลัมน์ตามต้นแบบ REA 1-11-2026: บัญชี | เดบิต | เครดิต)
// รายได้อยู่ฝั่งเดบิต ค่าใช้จ่ายฝั่งเครดิต ผลต่างเข้าบัญชีทุน (ตรงกับใบสำคัญที่ลงบัญชีจริง)
export async function GET(_: Request, { params }: { params: { id: string } }) {
  const au = await apiUser(['reports.read']); if (au instanceof Response) return au;
  const db = await getDb();
  const [c] = await db.q<any>(`select id, doc_no, closing_date::text d, period_from::text f, period_to::text t, equity_account, status, voucher_id from period_closings where id = $1 and deleted_at is null`, [/^[0-9a-f-]{36}$/.test(params.id) ? params.id : '00000000-0000-0000-0000-000000000000']);
  if (!c) return new Response('ไม่พบเอกสาร', { status: 404 });
  let rows: { code: string; name: string; type: string; amount: number }[];
  if (c.status === 'approved') {
    rows = (await db.q<any>(`select a.code, a.name, a.type, (l.debit - l.credit)::float8 dr from journal_lines l join accounts a on a.id = l.account_id where l.voucher_id = $1 order by l.line_no`, [c.voucher_id]))
      .map((r: any) => ({ code: r.code, name: r.name, type: r.type, amount: r.type === 'revenue' ? r.dr : r.type === 'expense' ? -r.dr : r.dr }));
  } else {
    rows = (await db.q<any>(`select section, code, name, amount::float8 amount from income_statement($1::date,$2::date)`, [c.f, c.t])).map((r: any) => ({ code: r.code, name: r.name, type: r.section === 'revenue' ? 'revenue' : 'expense', amount: r.amount }));
    const net = rows.filter(r => r.type === 'revenue').reduce((s, r) => s + r.amount, 0) - rows.filter(r => r.type === 'expense').reduce((s, r) => s + r.amount, 0);
    const [eq] = await db.q<any>(`select name from accounts where code = $1`, [c.equity_account]);
    if (net !== 0) rows.push({ code: c.equity_account, name: eq?.name ?? '', type: 'equity', amount: net < 0 ? -net : net * -1 });
  }
  const co = await companyOf(db);
  const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet('รายการปิดบัญชีรายได้และค่าใช้จ่าย');
  ws.addRow([co.name]); ws.addRow(['รายการปิดบัญชีรายได้และค่าใช้จ่าย']); ws.addRow([`ช่วงเวลา ${th(c.f)} - ${th(c.t)}`]); ws.addRow(['หน่วย:บาท']);
  for (let i = 1; i <= 4; i++) ws.mergeCells(i, 1, i, 5);
  ws.addRow(['บัญชี', null, null, 'เดบิต', 'เครดิต']); ws.mergeCells('A5:C5'); ws.getRow(5).font = { bold: true };
  const rev = rows.filter(r => r.type === 'revenue'), exp = rows.filter(r => r.type === 'expense'), eq = rows.find(r => r.type === 'equity');
  const revT = rev.reduce((s, r) => s + r.amount, 0), expT = exp.reduce((s, r) => s + r.amount, 0), net = revT - expT;
  ws.addRow(['รายได้', null, null, revT, null]).font = { bold: true };
  for (const r of rev) ws.addRow([null, r.code, r.name, r.amount >= 0 ? r.amount : null, r.amount < 0 ? -r.amount : null]);
  ws.addRow(['ค่าใช้จ่าย', null, null, null, expT]).font = { bold: true };
  for (const r of exp) ws.addRow([null, r.code, r.name, r.amount < 0 ? -r.amount : null, r.amount >= 0 ? r.amount : null]);
  const eqCode = eq?.code ?? c.equity_account, eqName = eq?.name ?? (await db.q<any>(`select name from accounts where code = $1`, [c.equity_account]))[0]?.name ?? '';
  if (net !== 0) ws.addRow([null, eqCode, eqName, net < 0 ? -net : null, net > 0 ? net : null]).font = { bold: true };
  const dr = Math.max(revT, 0) + Math.max(-net, 0), cr = Math.max(expT, 0) + Math.max(net, 0);
  ws.addRow(['รวมทั้งสิ้น', null, null, dr, cr]).font = { bold: true };
  ws.columns = [{ width: 12 }, { width: 15 }, { width: 40 }, { width: 25 }, { width: 25 }];
  ws.eachRow((r, n) => { if (n > 5) [4, 5].forEach(i => { r.getCell(i).numFmt = '#,##0.00'; }); });
  return send(wb, `รายการปิดบัญชี_${c.doc_no}`);
}
