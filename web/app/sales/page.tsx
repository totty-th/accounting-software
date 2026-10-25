import Link from 'next/link';
import { ClickRow } from '@/components/ClickRow';
import { redirect } from 'next/navigation';
import { getDb, today } from '@/lib/db';
import { money, dateTh, dateIso, partyName } from '@/lib/format';
import { Pill } from '@/components/Pill';
import { SalesActions } from '@/components/SalesActions';
import { DOC_TYPE, STATUS } from '@/lib/status';
import { PERIODS } from '@/lib/period';
import { listFilter, PER_PAGE, typeOf, type Sp } from '@/lib/sales-list';
import { QtTable, type QtRow } from '@/components/QtTable';
import { requirePage } from '@/lib/auth';
import { can, salesScope } from '@/lib/permissions';

export const dynamic = 'force-dynamic';
const href = (sp: Sp, over: Partial<Sp>) => {
  const u = new URLSearchParams();
  Object.entries({ ...sp, ...over }).forEach(([k, v]) => { if (v) u.set(k, String(v)); });
  return `/sales?${u}`;
};

export default async function Sales({ searchParams }: { searchParams: Sp }) {
  const user = await requirePage(['sales.read', 'quote.own']);
  const own = salesScope(user.role) === 'own-quotes';           // ฝ่ายขาย: เห็นเฉพาะใบเสนอราคาของตัวเอง
  const type = typeOf(searchParams, own);
  if (!type) redirect('/sales?type=INV');                        // เมนูย่อยแยกตามประเภท ไม่มีหน้ารวม
  const db = await getDb();
  const statuses = (await db.q(`select distinct status from sales_docs where doc_type=$1 and (not $2 or created_by=$3)`, [type, own, user.id])).map((r: any) => r.status as string);
  const status = statuses.includes(searchParams.status ?? '') ? searchParams.status! : '';
  const { q, period, where, args } = listFilter({ ...searchParams, status, ids: '' }, type, own, user.id);
  const pp = PER_PAGE.includes(Number(searchParams.pp)) ? Number(searchParams.pp) : 20;
  const page = Math.max(1, Number(searchParams.page) || 1);
  const [{ n, sum }] = await db.q(`select count(*)::int n, coalesce(sum(d.total) filter (where d.status not in ('cancelled','rejected')),0) sum
    from sales_docs d join contacts c on c.id=d.contact_id where ${where}`, args);
  const rows = await db.q(`select d.id, d.doc_type, d.doc_no, d.doc_date, d.due_date, d.status, d.total, d.is_deposit, d.project, d.vat_rate, d.subtotal, c.business_name, c.contact_name
    from sales_docs d join contacts c on c.id=d.contact_id where ${where}
    order by d.doc_date desc, d.doc_no desc limit ${pp} offset ${(page - 1) * pp}`, args);
  const pages = Math.max(1, Math.ceil(n / pp));
  let qtRows: QtRow[] = [];
  if (type === 'QT' && rows.length) {
    const ids = rows.map((r: any) => r.id);
    const rel = await db.q(`select ref_doc_id, doc_no, doc_type, status from sales_docs where ref_doc_id = any($1::uuid[]) and status<>'cancelled' order by doc_no`, [ids]);
    qtRows = await Promise.all(rows.map(async (r: any) => {
      const billing = ['partial', 'converted', 'deposit_paid'].includes(r.status) ? (await db.q(`select quotation_billing_summary($1) s`, [r.id]))[0]?.s : null;
      return { rate: Number(r.vat_rate), subtotal: Number(r.subtotal), id: r.id, doc_no: r.doc_no, date: dateIso(r.doc_date), status: r.status, total: Number(r.total), customer: partyName(r), project: r.project,
        related: rel.filter((x: any) => x.ref_doc_id === r.id).map((x: any) => ({ doc_no: x.doc_no, doc_type: x.doc_type, status: x.status })),
        billing: billing && r.status === 'deposit_paid' ? (() => {
          const ds = (billing.docs ?? []).filter((d: any) => d.is_deposit && d.status !== 'cancelled'), paid = ds.reduce((a: number, d: any) => a + Number(d.total), 0);
          return { deposit: true, total: Number(billing.total), billed: paid, closed: 0, remaining: Math.max(Number(billing.total) - paid, 0),
            percent: Number(billing.total) > 0 ? Math.round(paid * 10000 / Number(billing.total)) / 100 : 0, docs: ds };
        })() : billing && Number(billing.billed) + Number(billing.closed) > 0 ? (() => {
          const docs = (billing.docs ?? []).filter((d: any) => d.status !== 'cancelled');
          const dep = docs.filter((d: any) => d.is_deposit).reduce((a: number, d: any) => a + Number(d.total), 0);   // มัดจำที่รับแล้วนับเป็นยอดเรียกเก็บ (INV ฉบับสุดท้ายหักมัดจำออกแล้ว)
          const billed = Number(billing.billed) + dep, tot = Number(billing.total);
          return { total: tot, billed, closed: Number(billing.closed), remaining: Math.max(tot - billed - Number(billing.closed), 0),
            percent: tot > 0 ? Math.round((billed + Number(billing.closed)) * 10000 / tot) / 100 : 0, docs };
        })() : null } as QtRow;
    }));
  }
  const canNew = can(user.role, 'sales.write') || own;
  const noDue = type === 'QT';
  const name = DOC_TYPE[type];
  const sp: Sp = { type, q, period: period === 'all' ? '' : period, from: searchParams.from, to: searchParams.to, status, pp: String(pp) };
  const exportHref = `/sales/export?${new URLSearchParams(Object.entries({ type, q, period: sp.period, from: sp.from, status }).filter(([, v]) => v) as [string, string][])}${sp.to ? `&to=${sp.to}` : ''}`;
  return (
    <>
      <div className="top"><div><h1>{name}</h1><p className="sub">เอกสารขาย › {name} › {PERIODS.find(p => p[0] === period)![1]}</p></div>
        {!canNew || type === 'BL' ? null : <Link className="btn" href={type === 'CN' || type === 'DN' ? `/sales/adjust?type=${type}` : `/sales/new?type=${type}`}>+ สร้าง{name}ใหม่</Link>}</div>
      {type === 'BL' ? <div className="notice">ใบวางบิลสร้างจากใบแจ้งหนี้ (กำลังเพิ่มปุ่มในหน้านี้)</div> : null}
      <details className="panel" open={!!(q || status || period !== 'all')} style={{ marginBottom: 8 }}>
        <summary style={{ cursor: 'pointer' }}>🔍 ค้นหา{q || status || period !== 'all' ? ' (กำลังกรองอยู่)' : ''}</summary>
        <form className="row-inline" method="get" style={{ marginTop: 8 }}>
          <input type="hidden" name="type" value={type} /><input type="hidden" name="pp" value={pp} />
          <label className="f">ค้นหา (ชื่อลูกค้า / เลขที่เอกสาร / โปรเจ็ค / รายละเอียด)<input name="q" defaultValue={q} /></label>
          <label className="f">ช่วงเวลา<select name="period" defaultValue={period}>{PERIODS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className="f">ตั้งแต่ (ใช้เมื่อเลือกช่วงวันที่)<input type="date" name="from" defaultValue={searchParams.from ?? ''} /></label>
          <label className="f">ถึง<input type="date" name="to" defaultValue={searchParams.to ?? ''} /></label>
          <label className="f">สถานะเอกสาร<select name="status" defaultValue={status}>
            <option value="">แสดงทั้งหมด</option>{statuses.map(s => <option key={s} value={s}>{s === 'cancelled' ? 'เอกสารที่ถูกลบ/ยกเลิก' : STATUS[s]?.[0] ?? s}</option>)}</select></label>
          <button className="btn" type="submit">ค้นหา</button>
        </form>
      </details>
      {rows.length === 0 ? <div className="panel empty">ไม่พบ{name}ตามเงื่อนไขที่เลือก</div> : type === 'QT' ?
        <QtTable rows={qtRows} canWrite={can(user.role, 'sales.write')} canApprove={can(user.role, 'sales.approve')} canOwn={can(user.role, 'quote.own')} exportHref={exportHref} /> : (
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
        <span className="sub">{n} รายการ · หน้า {page}/{pages} · รายการต่อหน้า {PER_PAGE.map(x => x === pp ? <b key={x}> {x}</b> : <Link key={x} href={href(sp, { pp: String(x), page: '' })}> {x}</Link>)}</span>
        <span>{page > 1 && <Link className="btn sm ghost" href={href(sp, { page: String(page - 1) })}>ก่อนหน้า</Link>}{' '}
          {page < pages && <Link className="btn sm ghost" href={href(sp, { page: String(page + 1) })}>ถัดไป</Link>}</span>
        <strong>แสดงยอดรวมทั้งหมด (ไม่รวมที่ยกเลิก/ไม่อนุมัติ) {money(sum)}</strong>
      </div>
    </>
  );
}
