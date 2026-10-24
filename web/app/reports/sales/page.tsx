import Link from 'next/link';
import { getDb, today } from '@/lib/db';
import { money, dateTh, partyName } from '@/lib/format';
import { Pill } from '@/components/Pill';
import { DOC_TYPE } from '@/lib/status';
import { PERIODS, periodRange } from '@/lib/period';
import { requirePage } from '@/lib/auth';

export const dynamic = 'force-dynamic';
type Sp = { view?: string; period?: string; from?: string; to?: string; type?: string };
// รายงานสรุปยอดขาย: INV + ขายสด + ใบเพิ่มหนี้ เป็นบวก, ใบลดหนี้เป็นลบ · ไม่รวมใบเสนอราคา/ใบวางบิล/เอกสารที่ยกเลิก
const TYPES = ['INV', 'CA', 'CN', 'DN'];
const VIEWS: [string, string][] = [['summary', 'สรุปยอดขาย'], ['customer', 'ยอดขายตามลูกค้า'], ['product', 'ยอดขายตามสินค้า/รายการ']];

export default async function SalesReport({ searchParams }: { searchParams: Sp }) {
  await requirePage('reports.read');
  const view = VIEWS.some(v => v[0] === searchParams.view) ? searchParams.view! : 'summary';
  const period = PERIODS.some(p => p[0] === searchParams.period) ? searchParams.period! : 'month';
  const type = TYPES.includes(searchParams.type ?? '') ? searchParams.type! : '';
  const t = today();
  const range = periodRange(period, t, searchParams.from, searchParams.to);
  const db = await getDb();
  const args = [type, range?.[0] ?? null, range?.[1] ?? null];
  const base = `d.status<>'cancelled' and d.doc_type = any(array['INV','CA','CN','DN']) and ($1='' or d.doc_type=$1)
    and ($2::date is null or d.doc_date>=$2::date) and ($3::date is null or d.doc_date<=$3::date)`;
  const sgn = `case when d.doc_type='CN' then -1 else 1 end`;
  const [tot] = await db.q(`select count(*)::int n, coalesce(sum(d.subtotal*(${sgn})),0) sub, coalesce(sum(d.vat*(${sgn})),0) vat, coalesce(sum(d.total*(${sgn})),0) total
    from sales_docs d where ${base}`, args);
  let rows: any[] = [];
  if (view === 'summary') rows = await db.q(`select d.doc_no, d.doc_type, d.doc_date, d.status, c.business_name, c.contact_name,
      d.subtotal*(${sgn}) sub, d.vat*(${sgn}) vat, d.total*(${sgn}) total
    from sales_docs d join contacts c on c.id=d.contact_id where ${base} order by d.doc_date desc, d.doc_no desc`, args);
  if (view === 'customer') rows = await db.q(`select coalesce(c.business_name,c.contact_name,'-') name, count(*)::int n,
      sum(d.subtotal*(${sgn})) sub, sum(d.vat*(${sgn})) vat, sum(d.total*(${sgn})) total
    from sales_docs d join contacts c on c.id=d.contact_id where ${base} group by 1 order by total desc`, args);
  if (view === 'product') rows = await db.q(`select l.description name, sum(l.qty*(${sgn}))::numeric(18,4) qty, sum(l.amount*(${sgn})) sub
    from sales_docs d join sales_doc_lines l on l.doc_id=d.id where ${base} group by 1 order by sub desc`, args);
  const q = (o: Partial<Sp>) => { const u = new URLSearchParams(); Object.entries({ view, period, type, from: searchParams.from, to: searchParams.to, ...o }).forEach(([k, v]) => v && u.set(k, String(v))); return `/reports/sales?${u}`; };
  return (
    <>
      <div className="top"><div><h1>รายงานขาย</h1><p className="sub">ใบลดหนี้นับเป็นลบ · ไม่รวมเอกสารที่ยกเลิก ใบเสนอราคา และใบวางบิล</p></div></div>
      <div className="tabs">{VIEWS.map(([k, v]) => <Link key={k} href={q({ view: k })} className={view === k ? 'on' : ''}>{v}</Link>)}</div>
      <form className="row-inline" method="get">
        <input type="hidden" name="view" value={view} />
        <label className="f">ช่วงเวลา<select name="period" defaultValue={period}>{PERIODS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="f">ตั้งแต่<input type="date" name="from" defaultValue={searchParams.from ?? ''} /></label>
        <label className="f">ถึง<input type="date" name="to" defaultValue={searchParams.to ?? ''} /></label>
        <label className="f">ประเภทเอกสาร<select name="type" defaultValue={type}><option value="">ทั้งหมด</option>{TYPES.map(k => <option key={k} value={k}>{DOC_TYPE[k]}</option>)}</select></label>
        <button className="btn" type="submit">แสดงผล</button>
      </form>
      <div className="panel">
        <div className="sub">ณ วันที่ {dateTh(t)} · ช่วงเวลา {range ? `${dateTh(range[0])} - ${dateTh(range[1])}` : 'ทั้งหมด'} · {tot.n} เอกสาร</div>
        <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', marginTop: 8 }}>
          <div><div className="sub">มูลค่าก่อนภาษี</div><strong>{money(tot.sub)}</strong></div>
          <div><div className="sub">ภาษีมูลค่าเพิ่ม</div><strong>{money(tot.vat)}</strong></div>
          <div><div className="sub">ยอดรวมทั้งสิ้น</div><strong>{money(tot.total)}</strong></div>
        </div>
      </div>
      <div className="panel" style={{ padding: 0, overflowX: 'auto', marginTop: 14 }}>
        {rows.length === 0 ? <div className="empty">ไม่มีข้อมูลในช่วงที่เลือก</div> : view === 'summary' ? (
          <table><thead><tr><th>เลขที่เอกสาร</th><th>วันที่</th><th>ลูกค้า</th><th className="num">มูลค่า</th><th className="num">ภาษีมูลค่าเพิ่ม</th><th className="num">ยอดรวมสุทธิ</th><th>สถานะ</th></tr></thead>
            <tbody>{rows.map(r => <tr key={r.doc_no}><td className="no"><Link href={`/sales/${r.doc_no}`}>{r.doc_no}</Link></td><td>{dateTh(r.doc_date)}</td><td>{partyName(r)}</td>
              <td className="num">{money(r.sub)}</td><td className="num">{money(r.vat)}</td><td className="num">{money(r.total)}</td><td><Pill s={r.status} /></td></tr>)}</tbody></table>
        ) : view === 'customer' ? (
          <table><thead><tr><th>ลูกค้า</th><th className="num">จำนวนเอกสาร</th><th className="num">มูลค่า</th><th className="num">ภาษีมูลค่าเพิ่ม</th><th className="num">ยอดรวมสุทธิ</th></tr></thead>
            <tbody>{rows.map(r => <tr key={r.name}><td>{r.name}</td><td className="num">{r.n}</td><td className="num">{money(r.sub)}</td><td className="num">{money(r.vat)}</td><td className="num">{money(r.total)}</td></tr>)}</tbody></table>
        ) : (
          <table><thead><tr><th>รายการ</th><th className="num">จำนวน</th><th className="num">มูลค่าก่อนภาษี</th></tr></thead>
            <tbody>{rows.map(r => <tr key={r.name}><td>{r.name}</td><td className="num">{Number(r.qty).toLocaleString('th-TH', { maximumFractionDigits: 4 })}</td><td className="num">{money(r.sub)}</td></tr>)}</tbody></table>
        )}
      </div>
    </>
  );
}
