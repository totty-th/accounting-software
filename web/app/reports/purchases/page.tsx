import Link from 'next/link';
import { getDb, today } from '@/lib/db';
import { money, dateTh, partyName } from '@/lib/format';
import { Pill } from '@/components/Pill';
import { PERIODS, periodRange } from '@/lib/period';
import { requirePage } from '@/lib/auth';

export const dynamic = 'force-dynamic';
type Sp = { view?: string; period?: string; from?: string; to?: string; kind?: string };
// รายงานซื้อและค่าใช้จ่าย: ใบรับสินค้า (RI → สินค้าคงเหลือ) + ใบค่าใช้จ่าย (EXP → บัญชีค่าใช้จ่ายของแต่ละบรรทัด)
// นับรออนุมัติ/รอชำระ (บัญชีลงตั้งแต่สร้างเอกสาร) ไม่นับไม่อนุมัติ/ยกเลิก · แสดงมูลค่าก่อน VAT แยก VAT ซื้อ
// ยอดต้องตรงบัญชี — มีแผงกระทบยอด (purchase_expense_reconcile) และแยกการซื้อสินค้ากับค่าใช้จ่าย
const KINDS: [string, string][] = [['RI', 'ใบรับสินค้า (ซื้อสินค้า)'], ['EXP', 'ค่าใช้จ่าย']];
const VIEWS: [string, string][] = [['summary', 'สรุปรายเอกสาร'], ['vendor', 'ตามผู้จำหน่าย'], ['account', 'ตามบัญชี/หมวด']];
const ST: Record<string, string> = { unpaid: 'pending_approval', pending: 'pending_approval', approved: 'approved', paid: 'paid' };

export default async function PurchaseReport({ searchParams }: { searchParams: Sp }) {
  await requirePage('reports.read');
  const view = VIEWS.some(v => v[0] === searchParams.view) ? searchParams.view! : 'summary';
  const period = PERIODS.some(p => p[0] === searchParams.period) ? searchParams.period! : 'month';
  const kind = KINDS.some(k => k[0] === searchParams.kind) ? searchParams.kind! : '';
  const t = today();
  const range = periodRange(period, t, searchParams.from, searchParams.to);
  const db = await getDb();
  const a = [range?.[0] ?? null, range?.[1] ?? null];
  // รวม RI + EXP เป็นรายการเดียว (net = ก่อน VAT)
  const docs = `(select 'RI' k, g.id, g.ri_no no, g.ri_date dt, g.contact_id, g.status, g.subtotal net, g.vat, g.total from goods_receipts g
                  where g.status not in ('rejected','cancelled') and ($1::date is null or g.ri_date>=$1::date) and ($2::date is null or g.ri_date<=$2::date)
                union all
                 select 'EXP', e.id, e.exp_no, e.exp_date, e.contact_id, e.status, e.subtotal, e.vat, e.total from expenses e
                  where e.status not in ('rejected','cancelled') and ($1::date is null or e.exp_date>=$1::date) and ($2::date is null or e.exp_date<=$2::date)) d`;
  const where = kind ? `where d.k='${kind}'` : '';
  const [tot] = await db.q<any>(`select count(*)::int n, coalesce(sum(net),0) net, coalesce(sum(vat),0) vat, coalesce(sum(total),0) total from ${docs} ${where}`, a);
  let rows: any[] = [];
  if (view === 'summary') rows = await db.q(`select d.*, c.business_name, c.contact_name from ${docs} join contacts c on c.id=d.contact_id ${where} order by d.dt desc, d.no desc`, a);
  if (view === 'vendor') rows = await db.q(`select coalesce(c.business_name,c.contact_name,'-') name, count(*)::int n, sum(d.net) net, sum(d.vat) vat, sum(d.total) total
      from ${docs} join contacts c on c.id=d.contact_id ${where} group by 1 order by total desc`, a);
  if (view === 'account') rows = await db.q(`select x.code, coalesce(ac.name, case when x.code is null then 'สินค้าคงเหลือ (ใบรับสินค้า)' end) name, x.k, sum(x.net) net from (
      select 'RI' k, null::text code, g.subtotal net from goods_receipts g where g.status not in ('rejected','cancelled') and ($1::date is null or g.ri_date>=$1::date) and ($2::date is null or g.ri_date<=$2::date)
      union all
      select 'EXP', l.account_code, l.net from expense_lines l join expenses e on e.id=l.expense_id where e.status not in ('rejected','cancelled')
        and ($1::date is null or e.exp_date>=$1::date) and ($2::date is null or e.exp_date<=$2::date)) x
      left join accounts ac on ac.code=x.code ${kind ? `where x.k='${kind}'` : ''} group by x.code, ac.name, x.k order by x.k desc, x.code`, a);
  const rc = kind === '' ? (await db.q<any>('select purchase_expense_reconcile($1::date,$2::date) r', a))[0].r : null;
  const q = (o: Partial<Sp>) => { const u = new URLSearchParams(); Object.entries({ view, period, kind, from: searchParams.from, to: searchParams.to, ...o }).forEach(([k, v]) => v && u.set(k, String(v))); return `/reports/purchases?${u}`; };
  const href = (r: any) => r.k === 'RI' ? `/purchases/ri/${r.id}` : `/expenses/${r.id}`;
  return (
    <>
      <div className="top"><div><h1>รายงานซื้อและค่าใช้จ่าย</h1><p className="sub">มูลค่าก่อน VAT · ไม่รวมเอกสารที่ไม่อนุมัติ/ยกเลิก · ใบรับสินค้าเป็นสินค้าคงเหลือ ไม่ใช่ค่าใช้จ่ายจนกว่าจะขาย · ภาษีซื้อแยกต่างหาก</p></div></div>
      <div className="tabs">{VIEWS.map(([k, v]) => <Link key={k} href={q({ view: k })} className={view === k ? 'on' : ''}>{v}</Link>)}</div>
      <form className="row-inline" method="get">
        <input type="hidden" name="view" value={view} />
        <label className="f">ช่วงเวลา<select name="period" defaultValue={period}>{PERIODS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="f">ตั้งแต่<input type="date" name="from" defaultValue={searchParams.from ?? ''} /></label>
        <label className="f">ถึง<input type="date" name="to" defaultValue={searchParams.to ?? ''} /></label>
        <label className="f">ประเภท<select name="kind" defaultValue={kind}><option value="">ทั้งหมด</option>{KINDS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <button className="btn" type="submit">แสดงผล</button>
      </form>
      <div className="panel">
        <div className="sub">ณ วันที่ {dateTh(t)} · ช่วงเวลา {range ? `${dateTh(range[0])} - ${dateTh(range[1])}` : 'ทั้งหมด'} · {tot.n} เอกสาร</div>
        <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', marginTop: 8 }}>
          <div><div className="sub">มูลค่าก่อนภาษี</div><strong>{money(tot.net)}</strong></div>
          <div><div className="sub">ภาษีซื้อ</div><strong>{money(tot.vat)}</strong></div>
          <div><div className="sub">ยอดรวมทั้งสิ้น</div><strong>{money(tot.total)}</strong></div>
        </div>
      </div>
      {rc && <div className="panel" style={{ marginTop: 14 }}>
        <h3>กระทบยอดกับบัญชี</h3>
        <ul className="rel">
          <li>ซื้อสินค้า (ใบรับสินค้า → สินค้าคงเหลือ): <b>{money(rc.doc.ri)}</b> · ค่าใช้จ่าย: <b>{money(rc.doc.exp)}</b> · รวมตามเอกสาร <b>{money(rc.doc.total)}</b></li>
          <li>ตามบัญชี (ใบสำคัญจากใบรับสินค้า/ค่าใช้จ่าย): <b>{money(rc.gl.from_docs)}</b>{rc.gl.by_account.map((x: any) => <span key={x.code} className="sub"> · {x.code} {x.name} {money(x.amount)}</span>)}</li>
          <li>ผลต่าง: <b style={{ color: Number(rc.diff) === 0 && Number(rc.vat_diff) === 0 ? 'var(--green)' : 'var(--red)' }}>{money(rc.diff)}</b> (ภาษีซื้อ {money(rc.vat_diff)}) {Number(rc.diff) === 0 && Number(rc.vat_diff) === 0 ? '✓ ตรงกับบัญชี' : '— ไม่ตรง ต้องตรวจสอบ'}</li>
        </ul>
        {rc.gl.other_expense.length > 0 && <>
          <div className="sub" style={{ marginTop: 8 }}>ค่าใช้จ่าย/ต้นทุนที่ลงบัญชีโดยไม่ผ่านใบรับสินค้า-ค่าใช้จ่าย (ไม่รวมในยอดข้างบน)</div>
          <ul className="rel">{rc.gl.other_expense.map((o: any) => <li key={o.source + o.code}>{o.source} · {o.code} {o.name} · {money(o.amount)}</li>)}</ul></>}
      </div>}
      <div className="panel" style={{ padding: 0, overflowX: 'auto', marginTop: 14 }}>
        {rows.length === 0 ? <div className="empty">ไม่มีข้อมูลในช่วงที่เลือก</div> : view === 'summary' ? (
          <table><thead><tr><th>เลขที่เอกสาร</th><th>วันที่</th><th>ผู้จำหน่าย</th><th>ประเภท</th><th className="num">มูลค่า</th><th className="num">ภาษีซื้อ</th><th className="num">ยอดรวมสุทธิ</th><th>สถานะ</th></tr></thead>
            <tbody>{rows.map(r => <tr key={r.no}><td className="no"><Link href={href(r)}>{r.no}</Link></td><td>{dateTh(r.dt)}</td><td>{partyName(r)}</td>
              <td>{r.k === 'RI' ? 'ซื้อสินค้า' : 'ค่าใช้จ่าย'}</td><td className="num">{money(r.net)}</td><td className="num">{money(r.vat)}</td><td className="num">{money(r.total)}</td><td><Pill s={ST[r.status] ?? r.status} /></td></tr>)}</tbody></table>
        ) : view === 'vendor' ? (
          <table><thead><tr><th>ผู้จำหน่าย</th><th className="num">จำนวนเอกสาร</th><th className="num">มูลค่า</th><th className="num">ภาษีซื้อ</th><th className="num">ยอดรวมสุทธิ</th></tr></thead>
            <tbody>{rows.map(r => <tr key={r.name}><td>{r.name}</td><td className="num">{r.n}</td><td className="num">{money(r.net)}</td><td className="num">{money(r.vat)}</td><td className="num">{money(r.total)}</td></tr>)}</tbody></table>
        ) : (
          <table><thead><tr><th>บัญชี</th><th>ชื่อ</th><th>ที่มา</th><th className="num">มูลค่าก่อนภาษี</th></tr></thead>
            <tbody>{rows.map(r => <tr key={(r.code ?? 'inv') + r.k}><td className="no">{r.code ?? '11500'}</td><td>{r.name ?? '-'}</td><td>{r.k === 'RI' ? 'ใบรับสินค้า' : 'ค่าใช้จ่าย'}</td><td className="num">{money(r.net)}</td></tr>)}</tbody></table>
        )}
      </div>
    </>
  );
}
