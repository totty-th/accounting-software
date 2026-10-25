import Link from 'next/link';
import { getDb, today } from '@/lib/db';
import { money, dateTh, partyName } from '@/lib/format';
import { Pill } from '@/components/Pill';
import { DOC_TYPE, STATUS } from '@/lib/status';
import { PERIODS, periodRange } from '@/lib/period';
import { parseStatuses } from '@/lib/status-filter';
import { requirePage } from '@/lib/auth';

export const dynamic = 'force-dynamic';
type Sp = { period?: string; from?: string; to?: string; st?: string | string[] };
// รายงานการเก็บเงิน (ตามต้นแบบ): ใบแจ้งหนี้/ขายสด/ใบเพิ่มหนี้ + สถานะการเก็บเงิน + ช่องทางรับชำระ · ยอดรวมไม่นับใบที่ยกเลิก
const STATUSES = ['pending_collect', 'awaiting_payment', 'split_paid', 'receipt_opened', 'collected', 'cancelled'];
const METHOD: Record<string, string> = { cash: 'เงินสด', transfer: 'โอนเงิน', cheque: 'เช็ค', card: 'บัตร', other: 'อื่นๆ' };

export default async function CollectionReport({ searchParams }: { searchParams: Sp }) {
  await requirePage('reports.read');
  const period = PERIODS.some(p => p[0] === searchParams.period) ? searchParams.period! : 'month';
  const st = parseStatuses(searchParams.st, STATUSES);
  const t = today();
  const range = periodRange(period, t, searchParams.from, searchParams.to);
  const db = await getDb();
  const rows = await db.q(`select d.id, d.doc_no, d.doc_type, d.doc_date, d.status, d.total, c.business_name, c.contact_name,
      (select string_agg(distinct rp.method, ',') from receipt_items ri join receipts r on r.id=ri.receipt_id and r.status<>'cancelled'
         join receipt_payments rp on rp.receipt_id=r.id where ri.doc_id=d.id) methods
    from sales_docs d join contacts c on c.id=d.contact_id
    where d.doc_type in ('INV','CA','DN') and ($1::date is null or d.doc_date>=$1::date) and ($2::date is null or d.doc_date<=$2::date)
      and (cardinality($3::text[])=0 or d.status = any($3::text[]))
    order by d.doc_date desc, d.doc_no desc`, [range?.[0] ?? null, range?.[1] ?? null, `{${st.join(',')}}`]);
  const live = rows.filter(r => r.status !== 'cancelled');
  const total = live.reduce((s, r) => s + Number(r.total), 0);
  return (
    <>
      <div className="top"><div><h1>รายงานการเก็บเงิน</h1><p className="sub">ใบแจ้งหนี้ · ขายสด · ใบเพิ่มหนี้ · ยอดรวมไม่นับใบที่ยกเลิก</p></div></div>
      <form className="row-inline" method="get">
        <label className="f">ช่วงเวลา<select name="period" defaultValue={period}>{PERIODS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="f">ตั้งแต่<input type="date" name="from" defaultValue={searchParams.from ?? ''} /></label>
        <label className="f">ถึง<input type="date" name="to" defaultValue={searchParams.to ?? ''} /></label>
        <fieldset className="f" style={{ border: 0, padding: 0 }}><legend>สถานะ (ไม่เลือก = ทั้งหมด)</legend>
          {STATUSES.map(s => <label key={s} style={{ marginRight: 10 }}><input type="checkbox" name="st" value={s} defaultChecked={st.includes(s)} /> {STATUS[s]?.[0] ?? s}</label>)}</fieldset>
        <button className="btn" type="submit">แสดงผล</button>
      </form>
      <div className="panel">
        <div className="sub">ณ วันที่ {dateTh(t)} · ช่วงเวลา {range ? `${dateTh(range[0])} - ${dateTh(range[1])}` : 'ทั้งหมด'} · {live.length} เอกสาร{rows.length !== live.length ? ` (ยกเลิก ${rows.length - live.length} ไม่นับยอด)` : ''}</div>
        <div style={{ marginTop: 8 }}><div className="sub">ยอดรวมทั้งสิ้น</div><strong>{money(total)}</strong></div>
      </div>
      <div className="panel" style={{ padding: 0, overflowX: 'auto', marginTop: 14 }}>
        {rows.length === 0 ? <div className="empty">ไม่มีข้อมูลในช่วงที่เลือก</div> :
          <table><thead><tr><th>เลขที่เอกสาร</th><th>ประเภท</th><th>วันที่</th><th>ลูกค้า</th><th>ช่องทางรับชำระ</th><th className="num">ยอดรวมสุทธิ</th><th>สถานะ</th></tr></thead>
            <tbody>{rows.map(r => <tr key={r.id} style={r.status === 'cancelled' ? { opacity: .55 } : undefined}><td className="no"><Link href={`/sales/${r.doc_no}`}>{r.doc_no}</Link></td><td>{DOC_TYPE[r.doc_type]}</td><td>{dateTh(r.doc_date)}</td><td>{partyName(r)}</td>
              <td>{r.methods ? String(r.methods).split(',').map((m: string) => METHOD[m] ?? m).join(', ') : '-'}</td><td className="num">{money(r.total)}</td><td><Pill s={r.status} /></td></tr>)}</tbody></table>}
      </div>
    </>
  );
}
