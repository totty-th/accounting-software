import Link from 'next/link';
import { getDb, today } from '@/lib/db';
import { money, dateTh, partyName } from '@/lib/format';
import { Pill } from '@/components/Pill';
import { DOC_TYPE } from '@/lib/status';
import { periodRange } from '@/lib/period';
import { reportPeriod, pickStatuses, pgArr, SALES_BUCKETS } from '@/lib/report-filter';
import { ReportFilter } from '@/components/ReportFilter';
import { DocRows } from '@/components/DocRows';
import { requirePage } from '@/lib/auth';
import { ReportTools } from '@/components/ReportTools';

export const dynamic = 'force-dynamic';
type Sp = { view?: string; period?: string; from?: string; to?: string; type?: string; st?: string | string[] };
const ST_BUCKETS = SALES_BUCKETS;
const ST_OPTS: [string, string][] = [['wait', 'รอเก็บเงิน'], ['done', 'เก็บเงินแล้ว'], ['rcpt', 'เปิดใบเสร็จแล้ว'], ['split', 'แบ่งจ่าย'], ['ok', 'อนุมัติแล้ว/ใช้งาน (ใบลดหนี้/ใบเพิ่มหนี้)'], ['cancelled', 'ยกเลิก (แสดงแต่ไม่นับยอด)']];
// รายงานสรุปยอดขาย: INV + ขายสด + ใบเพิ่มหนี้ เป็นบวก, ใบลดหนี้เป็นลบ · ไม่รวมใบเสนอราคา/ใบวางบิล/เอกสารที่ยกเลิก/ใบมัดจำ (มัดจำไม่ใช่รายได้)
// ยอดต้องตรงบัญชีรายได้หมวด 41 — มีแผงกระทบยอดด้านล่าง (sales_revenue_reconcile)
const TYPES = ['INV', 'CA', 'CN', 'DN'];
const VIEWS: [string, string][] = [['summary', 'สรุปยอดขาย'], ['customer', 'ยอดขายตามลูกค้า'], ['employee', 'ยอดขายตามพนักงาน'], ['product', 'ยอดขายตามสินค้า/รายการ']];

export default async function SalesReport({ searchParams }: { searchParams: Sp }) {
  await requirePage('reports.read');
  const view = VIEWS.some(v => v[0] === searchParams.view) ? searchParams.view! : 'summary';
  const period = reportPeriod(searchParams.period);
  const { sel: stSel, list: stList } = pickStatuses(searchParams.st, ST_BUCKETS);
  const withCancel = stList.includes('cancelled');
  const type = TYPES.includes(searchParams.type ?? '') ? searchParams.type! : '';
  const t = today();
  const range = periodRange(period, t, searchParams.from, searchParams.to);
  const db = await getDb();
  const args = [type, range?.[0] ?? null, range?.[1] ?? null, pgArr(stList)];
  const base = `d.status<>'cancelled' and not d.is_deposit and d.doc_type = any(array['INV','CA','CN','DN']) and ($1='' or d.doc_type=$1)
    and ($2::date is null or d.doc_date>=$2::date) and ($3::date is null or d.doc_date<=$3::date)
    and (cardinality($4::text[])=0 or d.status = any($4::text[]))`;
  const rowBase = withCancel ? base.replace("d.status<>'cancelled' and ", '') : base;   // รายการเอกสารแสดงใบยกเลิกได้เมื่อเลือก (ยอดรวมไม่นับ)
  const sgn = `case when d.doc_type='CN' then -1 else 1 end`;
  const [tot] = await db.q(`select count(*)::int n, coalesce(sum(d.subtotal*(${sgn})),0) sub, coalesce(sum(d.vat*(${sgn})),0) vat, coalesce(sum(d.total*(${sgn})),0) total
    from sales_docs d where ${base}`, args);
  let rows: any[] = [];
  if (view === 'summary') rows = await db.q(`select d.doc_no, d.doc_type, d.doc_date, d.status, c.business_name, c.contact_name,
      d.id, d.subtotal*(${sgn}) sub, d.vat*(${sgn}) vat, d.total*(${sgn}) total
    from sales_docs d join contacts c on c.id=d.contact_id where ${rowBase} order by d.doc_date desc, d.doc_no desc`, args);
  let lineMap = new Map<string, any[]>();
  if (view === 'summary' && rows.length) {
    for (const l of await db.q<any>(`select doc_id, description, qty, unit_price, amount from sales_doc_lines where doc_id = any($1::uuid[]) order by doc_id, line_no`, [`{${rows.map(r => r.id).join(',')}}`]))
      lineMap.set(l.doc_id, [...(lineMap.get(l.doc_id) ?? []), l]);
  }
  if (view === 'customer') {   // ขยายดูเอกสารของลูกค้าแต่ละราย (ตามต้นแบบ) · ผลรวมกลุ่ม = ยอดขายตามเอกสาร
    const docs = await db.q(`select d.doc_no, d.doc_type, d.doc_date, d.status, coalesce(c.business_name,c.contact_name,'-') name,
        d.subtotal*(${sgn}) sub, d.vat*(${sgn}) vat, d.total*(${sgn}) total
      from sales_docs d join contacts c on c.id=d.contact_id where ${base} order by d.doc_date desc, d.doc_no desc`, args);
    const m = new Map<string, any>();
    for (const d of docs) { const g = m.get(d.name) ?? { name: d.name, n: 0, sub: 0, vat: 0, total: 0, docs: [] }; g.n++; g.sub += +d.sub; g.vat += +d.vat; g.total += +d.total; g.docs.push(d); m.set(d.name, g); }
    rows = [...m.values()].sort((a, b) => b.total - a.total);
  }
  if (view === 'employee') rows = await db.q(`select * from sales_by_salesperson($1::date,$2::date,$3::text[])`, [range?.[0] ?? null, range?.[1] ?? null, pgArr(stList)]); // ไม่กรองตามประเภทเอกสาร (ให้ผลรวมตรงยอดบัญชีเสมอ)
  if (view === 'product') rows = await db.q(`select description name, sum(qty)::numeric(18,4) qty, sum(net) sub
    from sales_report_lines($2::date,$3::date,nullif($1,''),$4::text[]) group by 1 order by sub desc`, args);
  const rc = type === '' && stSel.length === 0 ? (await db.q<any>('select sales_revenue_reconcile($1::date,$2::date) r', [range?.[0] ?? null, range?.[1] ?? null]))[0].r : null;
  const q = (o: Partial<Sp>) => { const u = new URLSearchParams(); Object.entries({ view, period, type, from: searchParams.from, to: searchParams.to, ...o }).forEach(([k, v]) => v && u.set(k, String(v))); stSel.forEach(v => u.append('st', v)); return `/reports/sales?${u}`; };
  return (
    <>
      <div className="top"><div><h1>รายงานขาย</h1><p className="sub">ใบลดหนี้นับเป็นลบ · ไม่รวมเอกสารที่ยกเลิก ใบเสนอราคา ใบวางบิล และใบมัดจำ</p></div></div>
      <div className="tabs noprint">{VIEWS.map(([k, v]) => <Link key={k} href={q({ view: k })} className={view === k ? 'on' : ''}>{v}</Link>)}</div>
      <ReportFilter period={period} from={searchParams.from} to={searchParams.to} groups={[{ label: 'เอกสารขาย', options: ST_OPTS }]} selected={stSel} hidden={{ view }} selects={[{ name: 'type', label: 'ประเภทเอกสาร', value: type, options: [['', 'ทั้งหมด'], ...TYPES.map(k => [k, DOC_TYPE[k]] as [string, string])] }]} />
      <div className="panel">
        <div className="sub">ณ วันที่ {dateTh(t)} · ช่วงเวลา {range ? `${dateTh(range[0])} - ${dateTh(range[1])}` : 'ทั้งหมด'} · {tot.n} เอกสาร</div>
        <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', marginTop: 8 }}>
          <div><div className="sub">มูลค่าก่อนภาษี</div><strong>{money(tot.sub)}</strong></div>
          <div><div className="sub">ภาษีมูลค่าเพิ่ม</div><strong>{money(tot.vat)}</strong></div>
          <div><div className="sub">ยอดรวมทั้งสิ้น</div><strong>{money(tot.total)}</strong></div>
        </div>
      </div>
      {rc && <div className="panel" style={{ marginTop: 14 }}>
        <h3>กระทบยอดกับบัญชีรายได้ (หมวด 41)</h3>
        <ul className="rel">
          <li>ยอดขายตามเอกสาร (ก่อน VAT): <b>{money(rc.doc.total)}</b> · INV {money(rc.doc.inv)} · ขายสด {money(rc.doc.ca)} · ใบเพิ่มหนี้ {money(rc.doc.dn)} · ใบลดหนี้ {money(rc.doc.cn)}</li>
          <li>ยอดรายได้ตามบัญชี (ใบสำคัญจากเอกสารขาย): <b>{money(rc.gl.from_docs)}</b>{rc.gl.by_account.map((a: any) => <span key={a.code} className="sub"> · {a.code} {a.name} {money(a.amount)}</span>)}</li>
          <li>ผลต่าง: <b style={{ color: Number(rc.diff) === 0 ? 'var(--green)' : 'var(--red)' }}>{money(rc.diff)}</b> {Number(rc.diff) === 0 ? '✓ ตรงกับบัญชี' : '— ไม่ตรง ต้องตรวจสอบ'}</li>
          {Number(rc.doc.deposit_count) > 0 && <li className="sub">ใบมัดจำ {rc.doc.deposit_count} ใบ รวม {money(rc.doc.deposit_excluded)} ไม่นับเป็นยอดขาย (บันทึกเป็นเงินมัดจำรับ จะเป็นรายได้เมื่อออกใบแจ้งหนี้ฉบับสุดท้าย)</li>}
        </ul>
        {rc.gl.manual_items.length > 0 && <>
          <div className="sub" style={{ marginTop: 8 }}>รายการบัญชีรายได้ที่ลงตรง (ไม่ผ่านเอกสารขาย เช่น ใบสำคัญทั่วไป) รวม {money(rc.gl.manual)} · ไม่นับในยอดขายข้างบน</div>
          <ul className="rel">{rc.gl.manual_items.map((m: any) => <li key={m.voucher_no + m.code}>{m.voucher_no} {dateTh(m.date)} · {m.code} {m.name} · {money(m.amount)}</li>)}</ul></>}
      </div>}
      <ReportTools exportBase="/reports/sales/export" modes={[['summary', 'Excel (สรุป)'], ['detail', 'Excel (แบบละเอียด)']]} title="รายงานขาย" meta={[['ช่วงเวลา :', range ? `${dateTh(range[0])} - ${dateTh(range[1])}` : 'ทั้งหมด']]} />
      <div data-report className="panel" style={{ padding: 0, overflowX: 'auto', marginTop: 4 }}>
        {rows.length === 0 ? <div className="empty">ไม่มีข้อมูลในช่วงที่เลือก</div> : view === 'summary' ? (
          <DocRows partyLabel="ลูกค้า" vatLabel="ภาษีมูลค่าเพิ่ม" rows={rows.map(r => ({ key: r.id, href: `/sales/${r.doc_no}`, no: r.doc_no, date: dateTh(r.doc_date), party: partyName(r),
            net: Number(r.sub), vat: Number(r.vat), total: Number(r.total), status: r.status, dim: r.status === 'cancelled',
            lines: (lineMap.get(r.id) ?? []).map((l: any) => ({ d: l.description, q: `${Number(l.qty).toLocaleString('th-TH', { maximumFractionDigits: 4 })} × ${money(l.unit_price)}`, net: Number(l.amount) })) }))} />
        ) : view === 'customer' ? (
          <table><thead><tr><th>ลูกค้า</th><th className="num">จำนวนเอกสาร</th><th className="num">มูลค่า</th><th className="num">ภาษีมูลค่าเพิ่ม</th><th className="num">ยอดรวมสุทธิ</th></tr></thead>
            {rows.map(r => <tbody key={r.name}><tr><td><details><summary style={{ cursor: 'pointer' }}>{r.name}</summary>
              <ul className="rel">{r.docs.map((d: any) => <li key={d.doc_no}><Link href={`/sales/${d.doc_no}`}>{d.doc_no}</Link> · {dateTh(d.doc_date)} · {money(d.sub)} · <Pill s={d.status} /></li>)}</ul></details></td>
              <td className="num">{r.n}</td><td className="num">{money(r.sub)}</td><td className="num">{money(r.vat)}</td><td className="num">{money(r.total)}</td></tr></tbody>)}</table>
        ) : view === 'employee' ? (
          <table><thead><tr><th>พนักงานขาย</th><th className="num">จำนวนลูกค้า</th><th className="num">จำนวนเอกสาร</th><th className="num">มูลค่า</th><th className="num">ภาษีมูลค่าเพิ่ม</th><th className="num">ยอดรวมสุทธิ</th></tr></thead>
            <tbody>{rows.map(r => <tr key={r.salesperson}><td>{r.salesperson}</td><td className="num">{r.customer_count}</td><td className="num">{r.doc_count}</td><td className="num">{money(r.sub)}</td><td className="num">{money(r.vat)}</td><td className="num">{money(r.total)}</td></tr>)}</tbody></table>
        ) : (
          <table><thead><tr><th>รายการ</th><th className="num">จำนวน</th><th className="num">มูลค่าก่อนภาษี</th></tr></thead>
            <tbody>{rows.map(r => <tr key={r.name}><td>{r.name}</td><td className="num">{Number(r.qty).toLocaleString('th-TH', { maximumFractionDigits: 4 })}</td><td className="num">{money(r.sub)}</td></tr>)}</tbody></table>
        )}
      </div>
    </>
  );
}
