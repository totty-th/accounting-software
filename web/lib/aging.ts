import ExcelJS from 'exceljs';
import { getDb, today } from './db';
import { dateTh } from './format';
import { splitByAccount, AR_ACCOUNTS, AP_ACCOUNTS } from './aging-accounts';

export type Kind = 'ar' | 'ap';
export const BUCKETS = ['not_due', 'd1_30', 'd31_60', 'd61_90', 'over90'] as const;
export const BUCKET_LABEL = ['ยังไม่ถึงกำหนด', '1-30 วัน', '31-60 วัน', '61-90 วัน', 'เกิน 90 วัน'];

export interface Group { contact_id: string; name: string; rows: any[]; tot: Record<string, number> }

export type Sp = { asof?: string; contact?: string; coa?: string; bl?: string; mode?: string };
export const accountsOf = (k: Kind) => (k === 'ar' ? AR_ACCOUNTS : AP_ACCOUNTS);

export async function loadAging(kind: Kind, sp: Sp) {
  const asof = sp.asof || today(), contact = sp.contact || null;
  const db = await getDb();
  const rows = await db.q(`select * from (select * from ${kind}_aging($1::date,$2::uuid)
      ${kind === 'ar' && sp.bl === '1' ? 'union all select * from ar_aging_bl($1::date,$2::uuid)' : ''}) x order by contact_name, due_date, doc_no`, [asof, contact]);
  if (sp.mode === 'doc') {  // วิเคราะห์อายุตามวันที่เอกสาร (ตัวเลือกแบบ FA): แบ่งช่วงจากวันที่เอกสารแทนวันครบกำหนด
    const bk = await db.q<any>(`select r.doc_id, aging_bucket($1::date, r.doc_date) b from jsonb_to_recordset($2::jsonb) as r(doc_id uuid, doc_date date)`,
      [asof, JSON.stringify(rows.map((r: any) => ({ doc_id: r.doc_id, doc_date: r.doc_date instanceof Date ? r.doc_date.toISOString().slice(0, 10) : String(r.doc_date).slice(0, 10) })))]);
    const m = new Map(bk.map((x: any) => [x.doc_id, x.b]));
    for (const r of rows as any[]) for (const b of BUCKETS) r[b] = m.get(r.doc_id) === b ? r.outstanding : 0;
  }
  const contacts = await db.q(`select id, contact_label(id) as label from contacts order by 2`).catch(() => [] as any[]);
  const accs = accountsOf(kind).map(a => a[0]);
  const keys = ['outstanding', ...BUCKETS, ...accs];
  const zero = () => Object.fromEntries(keys.map(k => [k, 0])) as Record<string, number>;
  const groups: Group[] = [], grand = zero();
  for (const r of rows) {
    Object.assign(r, splitByAccount(kind, r));
    let g = groups[groups.length - 1];
    if (!g || g.contact_id !== r.contact_id) groups.push(g = { contact_id: r.contact_id, name: r.contact_name, rows: [], tot: zero() });
    g.rows.push(r);
    for (const k of keys) { g.tot[k] += Number(r[k]); grand[k] += Number(r[k]); }
  }
  return { asof, contact, groups, grand, contacts, count: rows.length };
}

export async function buildXlsx(kind: Kind, sp: Sp) {
  const { asof, groups, grand } = await loadAging(kind, sp);
  const db = await getDb();
  const co = (await db.q('select name, tax_id from company_profile limit 1'))[0] ?? {};
  const ar = kind === 'ar', coa = sp.coa === '1', accs = coa ? accountsOf(kind) : [];
  const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet(ar ? 'ลูกหนี้ตามเอกสาร' : 'เจ้าหนี้ตามเอกสาร');
  const head = ['เลขที่เอกสาร', 'วันที่เอกสาร', 'วันครบกำหนด', ...(ar ? ['ยอดรวม', 'รับชำระแล้ว'] : ['ยอดรวม']), 'ยอดค้างชำระ', ...BUCKET_LABEL, ...accs.map(a => `${a[0]} ${a[1]}`)];
  const n = head.length, numFrom = 4;
  const title = (ar ? 'รายงานลูกหนี้ตามเอกสาร' : 'รายงานเจ้าหนี้ตามเอกสาร') + (coa ? 'และผังบัญชี' : '');
  [title, co.name ?? '', co.tax_id ? `เลขประจำตัวผู้เสียภาษี ${co.tax_id}` : '', `ณ วันที่ ${dateTh(asof)}`].forEach((t, i) => {
    ws.mergeCells(i + 1, 1, i + 1, n); const c = ws.getCell(i + 1, 1); c.value = t; c.font = { bold: i === 0, size: i === 0 ? 14 : 11 };
  });
  const hr = ws.getRow(6); hr.values = head;
  hr.eachCell(c => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E9C' } }; c.alignment = { horizontal: 'center' }; });
  const fmt = '#,##0.00';
  const put = (vals: any[], bold = false) => {
    const r = ws.addRow(vals);
    r.eachCell((c, i) => { if (i >= numFrom) c.numFmt = fmt; if (bold) c.font = { bold: true }; });
    return r;
  };
  for (const g of groups) {
    const r = ws.addRow([g.name]); r.font = { bold: true };
    for (const x of g.rows) put([x.doc_no, dateTh(x.doc_date), dateTh(x.due_date),
      ...(ar ? [Number(x.doc_total), Number(x.receipted)] : [Number(x.doc_total)]), Number(x.outstanding), ...BUCKETS.map(b => Number(x[b])), ...accs.map(a => Number(x[a[0]]))]);
    put([`รวม ${g.name}`, '', '', ...(ar ? ['', ''] : ['']), g.tot.outstanding, ...BUCKETS.map(b => g.tot[b]), ...accs.map(a => g.tot[a[0]])], true);
  }
  put(['รวมทั้งสิ้น', '', '', ...(ar ? ['', ''] : ['']), grand.outstanding, ...BUCKETS.map(b => grand[b]), ...accs.map(a => grand[a[0]])], true);
  ws.columns.forEach((c, i) => { c.width = i === 0 ? 24 : 16; });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function xlsxResponse(buf: Buffer, name: string) {
  return new Response(new Uint8Array(buf), { headers: {
    'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'content-disposition': `attachment; filename="${name}.xlsx"`, 'cache-control': 'no-store' } });
}
