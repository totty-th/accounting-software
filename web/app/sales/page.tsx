import Link from 'next/link';
import { ClickRow } from '@/components/ClickRow';
import { redirect } from 'next/navigation';
import { getDb, today } from '@/lib/db';
import { money, dateTh, partyName } from '@/lib/format';
import { Pill } from '@/components/Pill';
import { SalesActions } from '@/components/SalesActions';
import { DOC_TYPE, STATUS } from '@/lib/status';
import { PERIODS, periodRange } from '@/lib/period';
import { requirePage } from '@/lib/auth';
import { can, salesScope } from '@/lib/permissions';

export const dynamic = 'force-dynamic';
const PAGE = 20;
type Sp = { type?: string; q?: string; period?: string; from?: string; to?: string; status?: string; page?: string };
const href = (sp: Sp, over: Partial<Sp>) => {
  const u = new URLSearchParams();
  Object.entries({ ...sp, ...over }).forEach(([k, v]) => { if (v) u.set(k, String(v)); });
  return `/sales?${u}`;
};

export default async function Sales({ searchParams }: { searchParams: Sp }) {
  const user = await requirePage(['sales.read', 'quote.own']);
  const own = salesScope(user.role) === 'own-quotes';           // ฝ่ายขาย: เห็นเฉพาะใบเสนอราคาของตัวเอง
  const type = own ? 'QT' : DOC_TYPE[searchParams.type ?? ''] ? searchParams.type! : '';
  if (!type) redirect('/sales?type=INV');                        // เมนูย่อยแยกตามประเภท ไม่มีหน้ารวม
  const q = (searchParams.q ?? '').trim();
  const period = PERIODS.some(p => p[0] === searchParams.period) ? searchParams.period! : 'all';
  const range = periodRange(period, today(), searchParams.from, searchParams.to);
  const page = Math.max(1, Number(searchParams.page) || 1);
  const db = await getDb();
  const statuses = (await db.q(`select distinct status from sales_docs where doc_type=$1 and (not $2 or created_by=$3)`, [type, own, user.id])).map((r: any) => r.status as string);
  const status = statuses.includes(searchParams.status ?? '') ? searchParams.status! : '';
  const where = `d.doc_type=$1 and (not $2 or d.created_by=$3) and ($4='' or d.status=$4)
    and ($5::date is null or d.doc_date >= $5::date) and ($6::date is null or d.doc_date <= $6::date)
    and ($7='' or d.doc_no ilike '%'||$7||'%' or c.business_name ilike '%'||$7||'%' or c.contact_name ilike '%'||$7||'%')`;
  const args = [type, own, user.id, status, range?.[0] ?? null, range?.[1] ?? null, q];
  const [{ n, sum }] = await db.q(`select count(*)::int n, coalesce(sum(d.total) filter (where d.status<>'cancelled'),0) sum
    from sales_docs d join contacts c on c.id=d.contact_id where ${where}`, args);
  const rows = await db.q(`select d.id, d.doc_type, d.doc_no, d.doc_date, d.due_date, d.status, d.total, d.is_deposit, c.business_name, c.contact_name
    from sales_docs d join contacts c on c.id=d.contact_id where ${where}
    order by d.doc_date desc, d.doc_no desc limit ${PAGE} offset ${(page - 1) * PAGE}`, args);
  const pages = Math.max(1, Math.ceil(n / PAGE));
  const canNew = can(user.role, 'sales.write') || own;
  const noDue = type === 'QT';
  const name = DOC_TYPE[type];
  const sp: Sp = { type, q, period: period === 'all' ? '' : period, from: searchParams.from, to: searchParams.to, status };
  return (
    <>
      <div className="top"><div><h1>{name}</h1><p className="sub">เอกสารขาย › {name} › {PERIODS.find(p => p[0] === period)![1]}</p></div>
        {!canNew || type === 'BL' ? null : <Link className="btn" href={type === 'CN' || type === 'DN' ? `/sales/adjust?type=${type}` : `/sales/new?type=${type}`}>+ สร้าง{name}ใหม่</Link>}</div>
      {type === 'BL' ? <div className="notice">ใบวางบิลสร้างจากใบแจ้งหนี้ (กำลังเพิ่มปุ่มในหน้านี้)</div> : null}
      <form className="row-inline" method="get">
        <input type="hidden" name="type" value={type} />
        <label className="f">ค้นหา (ชื่อลูกค้า / เลขที่เอกสาร)<input name="q" defaultValue={q} /></label>
        <label className="f">ช่วงเวลา<select name="period" defaultValue={period}>{PERIODS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="f">ตั้งแต่ (ใช้เมื่อเลือกช่วงวันที่)<input type="date" name="from" defaultValue={searchParams.from ?? ''} /></label>
        <label className="f">ถึง<input type="date" name="to" defaultValue={searchParams.to ?? ''} /></label>
        <label className="f">สถานะ<select name="status" defaultValue={status}>
          <option value="">แสดงทั้งหมด</option>{statuses.map(s => <option key={s} value={s}>{STATUS[s]?.[0] ?? s}</option>)}</select></label>
        <button className="btn" type="submit">ค้นหา</button>
      </form>
      {rows.length === 0 ? <div className="panel empty">ไม่พบ{name}ตามเงื่อนไขที่เลือก</div> : (
        <div className="panel" style={{ padding: 0, overflowX: 'auto' }}>
          <table><thead><tr><th>วันที่</th><th>เลขที่เอกสาร</th><th>ชื่อลูกค้า</th>{!noDue && <th>ครบกำหนด</th>}<th className="num">ยอดรวมสุทธิ</th><th>สถานะ</th><th /></tr></thead>
            <tbody>{rows.map(r => (
              <ClickRow key={r.id} href={`/sales/${r.doc_no}`} style={r.status === 'cancelled' ? { opacity: .55 } : undefined}>
                <td>{dateTh(r.doc_date)}</td>
                <td className="no"><Link href={`/sales/${r.doc_no}`}>{r.doc_no}</Link>{r.is_deposit ? ' (มัดจำ)' : ''}</td>
                <td>{partyName(r)}</td>{!noDue && <td>{dateTh(r.due_date)}</td>}
                <td className="num">{money(r.total)}</td><td><Pill s={r.status} /></td><td><SalesActions d={r} role={user.role} /></td></ClickRow>))}</tbody></table>
        </div>)}
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginTop: 12 }}>
        <span className="sub">{n} รายการ · หน้า {page}/{pages}</span>
        <span>{page > 1 && <Link className="btn sm ghost" href={href(sp, { page: String(page - 1) })}>ก่อนหน้า</Link>}{' '}
          {page < pages && <Link className="btn sm ghost" href={href(sp, { page: String(page + 1) })}>ถัดไป</Link>}</span>
        <strong>ยอดรวมทั้งหมด (ไม่รวมที่ยกเลิก) {money(sum)}</strong>
      </div>
    </>
  );
}
