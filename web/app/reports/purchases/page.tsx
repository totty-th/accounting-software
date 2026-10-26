import Link from 'next/link';
import { getDb, today } from '@/lib/db';
import { money, dateTh, partyName } from '@/lib/format';
import { Pill } from '@/components/Pill';
import { periodRange } from '@/lib/period';
import { reportPeriod, pickStatuses, pgArr, PURCHASE_BUCKETS } from '@/lib/report-filter';
import { ReportFilter } from '@/components/ReportFilter';
import { DocRows } from '@/components/DocRows';
import { requirePage } from '@/lib/auth';
import { ReportTools } from '@/components/ReportTools';

export const dynamic = 'force-dynamic';
type Sp = { view?: string; period?: string; from?: string; to?: string; kind?: string; doc?: string; st?: string | string[] };
const ST_BUCKETS = PURCHASE_BUCKETS;
const ST_OPTS: [string, string][] = [['pend', 'รออนุมัติ/รอดำเนินการ'], ['appr', 'อนุมัติแล้ว'], ['paid', 'ชำระเงินแล้ว'], ['cancelled', 'ยกเลิก/ไม่อนุมัติ (แสดงแต่ไม่นับยอด)']];
// รายงานซื้อและค่าใช้จ่าย: ใบรับสินค้า (RI → สินค้าคงเหลือ) + ใบค่าใช้จ่าย (EXP → บัญชีค่าใช้จ่ายของแต่ละบรรทัด)
// นับรออนุมัติ/รอชำระ (บัญชีลงตั้งแต่สร้างเอกสาร) ไม่นับไม่อนุมัติ/ยกเลิก · แสดงมูลค่าก่อน VAT แยก VAT ซื้อ
// ยอดต้องตรงบัญชี — มีแผงกระทบยอด (purchase_expense_reconcile) และแยกการซื้อสินค้ากับค่าใช้จ่าย
const KINDS: [string, string][] = [['RI', 'ใบรับสินค้า (ซื้อสินค้า)'], ['EXP', 'ค่าใช้จ่าย']];
const VIEWS: [string, string][] = [['summary', 'สรุปรายเอกสาร'], ['vendor', 'ตามผู้จำหน่าย'], ['account', 'ตามบัญชี/หมวด']];
const ST: Record<string, string> = { unpaid: 'pending_approval', pending: 'pending_approval', approved: 'approved', paid: 'paid' };

export default async function PurchaseReport({ searchParams }: { searchParams: Sp }) {
  await requirePage('reports.read');
  const view = VIEWS.some(v => v[0] === searchParams.view) ? searchParams.view! : 'summary';
  const period = reportPeriod(searchParams.period);
  const { sel: stSel, list: stList } = pickStatuses(searchParams.st, ST_BUCKETS);
  const withCancel = stList.includes('cancelled');
  const kind = KINDS.some(k => k[0] === searchParams.kind) ? searchParams.kind! : '';
  const t = today();
  const range = periodRange(period, t, searchParams.from, searchParams.to);
  const db = await getDb();
  const a = [range?.[0] ?? null, range?.[1] ?? null];
  const stCond = `(cardinality($3::text[])=0 or d.status = any($3::text[]))`;
  const live = `d.status not in ('rejected','cancelled')`;
  const a3 = [...a, pgArr(stList)];
  // รวม RI + EXP เป็นรายการเดียว (net = ก่อน VAT)
  const docs = `(select 'RI' k, g.id, g.ri_no no, g.ri_date dt, g.contact_id, g.status, g.subtotal net, g.vat, g.total from goods_receipts g
                  where ($1::date is null or g.ri_date>=$1::date) and ($2::date is null or g.ri_date<=$2::date)
                union all
                 select 'EXP', e.id, e.exp_no, e.exp_date, e.contact_id, e.status, e.subtotal, e.vat, e.total from expenses e
                  where ($1::date is null or e.exp_date>=$1::date) and ($2::date is null or e.exp_date<=$2::date)) d`;
  const kindC = kind ? `d.k='${kind}'` : 'true';
  const where = `where ${live} and ${stCond} and ${kindC}`;
  const rowsWhere = `where ${withCancel ? 'true' : live} and ${stCond} and ${kindC}`;
  const [tot] = await db.q<any>(`select count(*)::int n, coalesce(sum(net),0) net, coalesce(sum(vat),0) vat, coalesce(sum(total),0) total from ${docs} ${where}`, a3);
  let rows: any[] = [];
  if (view === 'summary') rows = await db.q(`select d.*, c.business_name, c.contact_name from ${docs} join contacts c on c.id=d.contact_id ${rowsWhere} order by d.dt desc, d.no desc`, a3);
  if (view === 'vendor') rows = await db.q(`select coalesce(c.business_name,c.contact_name,'-') name, count(*)::int n, sum(d.net) net, sum(d.vat) vat, sum(d.total) total
      from ${docs} join contacts c on c.id=d.contact_id ${where} group by 1 order by total desc`, a3);
  if (view === 'account') rows = await db.q(`select x.code, coalesce(ac.name, case when x.code is null then 'สินค้าคงเหลือ (ใบรับสินค้า)' end) name, x.k, sum(x.net) net from (
      select 'RI' k, null::text code, g.subtotal net, g.status from goods_receipts g where g.status not in ('rejected','cancelled') and ($1::date is null or g.ri_date>=$1::date) and ($2::date is null or g.ri_date<=$2::date)
      union all
      select 'EXP', l.account_code, l.net, e.status from expense_lines l join expenses e on e.id=l.expense_id where e.status not in ('rejected','cancelled')
        and ($1::date is null or e.exp_date>=$1::date) and ($2::date is null or e.exp_date<=$2::date)) x
      left join accounts ac on ac.code=x.code where (cardinality($3::text[])=0 or x.status = any($3::text[])) ${kind ? `and x.k='${kind}'` : ''} group by x.code, ac.name, x.k order by x.k desc, x.code`, a3);
  const acctAll = await db.q<any>(`select v.voucher_no no, v.voucher_date dt, v.memo, sum(l.debit - l.credit) filter (where a.type = 'expense') val,
      case when v.reverses_id is not null or exists (select 1 from journal_vouchers r where r.reverses_id = v.id) then 'cancelled' else 'approved' end status
    from journal_vouchers v join journal_lines l on l.voucher_id = v.id join accounts a on a.id = l.account_id
    where v.voucher_no ~ '^JV' and ($1::date is null or v.voucher_date >= $1::date) and ($2::date is null or v.voucher_date <= $2::date)
    group by v.id having bool_or(a.type = 'expense') order by v.voucher_date desc, v.voucher_no desc`, a);
  const acct = acctAll.filter(r => stSel.length === 0 || (stSel.includes('appr') && r.status === 'approved') || (stSel.includes('cancelled') && r.status === 'cancelled'));
  const acctTot = acct.filter(r => r.status !== 'cancelled').reduce((x, r) => x + Number(r.val), 0);
  const isAcct = searchParams.doc === 'acct';
  const lineMap = new Map<string, any[]>();
  if (view === 'summary' && rows.length) {
    const ids = `{${rows.map(r => r.id).join(',')}}`;
    for (const l of await db.q<any>(`select l.expense_id id, l.description d, null::numeric qty, l.net, l.vat, coalesce(l.category, l.account_code) tag from expense_lines l where l.expense_id = any($1::uuid[])
        union all select l.ri_id, p.name, l.qty, l.net, l.vat, 'สินค้า' from goods_receipt_lines l join products p on p.id=l.product_id where l.ri_id = any($1::uuid[])`, [ids]))
      lineMap.set(l.id, [...(lineMap.get(l.id) ?? []), l]);
  }
  const rc = kind === '' && stSel.length === 0 ? (await db.q<any>('select purchase_expense_reconcile($1::date,$2::date) r', a))[0].r : null;
  const q = (o: Partial<Sp>) => { const u = new URLSearchParams(); Object.entries({ view, period, kind, doc: searchParams.doc, from: searchParams.from, to: searchParams.to, ...o }).forEach(([k, v]) => v && u.set(k, String(v))); stSel.forEach(v => u.append('st', v)); return `/reports/purchases?${u}`; };
  const href = (r: any) => r.k === 'RI' ? `/purchases/ri/${r.id}` : `/expenses/${r.id}`;
  return (
    <>
      <div className="top"><div><h1>รายงานซื้อและค่าใช้จ่าย</h1><p className="sub">มูลค่าก่อน VAT · ไม่รวมเอกสารที่ไม่อนุมัติ/ยกเลิก · ใบรับสินค้าเป็นสินค้าคงเหลือ ไม่ใช่ค่าใช้จ่ายจนกว่าจะขาย · ภาษีซื้อแยกต่างหาก</p></div></div>
      <div className="tabs noprint">
        <Link href={q({ doc: '' })} className={!isAcct ? 'on' : ''}>เอกสารซื้อ ({tot.n})</Link>
        <Link href={q({ doc: 'acct' })} className={isAcct ? 'on' : ''}>เอกสารบัญชี ({acctAll.length})</Link></div>
      {!isAcct && <div className="tabs noprint">{VIEWS.map(([k, v]) => <Link key={k} href={q({ view: k })} className={view === k ? 'on' : ''}>{v}</Link>)}</div>}
      <ReportFilter period={period} from={searchParams.from} to={searchParams.to} groups={[{ label: 'เอกสารซื้อ/ค่าใช้จ่าย', options: ST_OPTS }]} selected={stSel} hidden={{ view, doc: isAcct ? 'acct' : '' }}
        selects={[{ name: 'kind', label: 'ประเภท', value: kind, options: [['', 'ทั้งหมด'], ...KINDS] }]} />
      <div className="panel">
        <div className="sub">ณ วันที่ {dateTh(t)} · ช่วงเวลา {range ? `${dateTh(range[0])} - ${dateTh(range[1])}` : 'ทั้งหมด'} · {tot.n + acct.length} เอกสาร (เอกสารซื้อ {tot.n} · เอกสารบัญชี {acct.length})</div>
        <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', marginTop: 8 }}>
          <div title={`เอกสารซื้อ ${money(tot.net)} · เอกสารบัญชี ${money(acctTot)}`}><div className="sub">ยอดรวมก่อนภาษี (ซื้อ+บัญชี) ⓘ</div><strong>{money(Number(tot.net) + acctTot)}</strong>
            <div className="sub">เอกสารซื้อ {money(tot.net)} · เอกสารบัญชี {money(acctTot)}</div></div>
          <div><div className="sub">ภาษีซื้อ</div><strong>{money(tot.vat)}</strong></div>
          <div><div className="sub">ยอดรวมทั้งสิ้น</div><strong>{money(Number(tot.total) + acctTot)}</strong></div>
        </div>
        {isAcct && <div className="sub" style={{ marginTop: 6 }}>แท็บนี้ = ใบสำคัญค่าใช้จ่ายที่ลงบัญชีโดยตรง (ใบกลับรายการแสดงติดลบ ไม่นับยอด) · รวม {money(acctTot)}</div>}
      </div>
      {rc && !isAcct && <div className="panel" style={{ marginTop: 14 }}>
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
      <ReportTools exportBase="/reports/purchases/export" modes={[['summary', 'Excel (สรุป)'], ['detail', 'Excel (แบบละเอียด)']]} title="รายงานซื้อและค่าใช้จ่าย" meta={[['ช่วงเวลา :', range ? `${dateTh(range[0])} - ${dateTh(range[1])}` : 'ทั้งหมด']]} />
      <div data-report className="panel" style={{ padding: 0, overflowX: 'auto', marginTop: 4 }}>
        {isAcct ? (acct.length === 0 ? <div className="empty">ไม่มีข้อมูลในช่วงที่เลือก</div> :
          <table><thead><tr><th>เลขที่เอกสาร</th><th>วันที่</th><th>รายละเอียด</th><th className="num">มูลค่า</th><th>สถานะ</th></tr></thead>
            <tbody>{acct.map(r => <tr key={r.no} style={r.status === 'cancelled' ? { opacity: .55 } : undefined}><td className="no">{r.no}</td><td>{dateTh(r.dt)}</td><td>{r.memo ?? ''}</td>
              <td className="num">{money(r.val)}</td><td><Pill s={r.status === 'approved' ? 'approved' : 'cancelled'} /></td></tr>)}</tbody></table>)
        : rows.length === 0 ? <div className="empty">ไม่มีข้อมูลในช่วงที่เลือก</div> : view === 'summary' ? (
          <DocRows partyLabel="ผู้จำหน่าย" kindLabel="ประเภท" vatLabel="ภาษีซื้อ" rows={rows.map(r => ({ key: r.id, href: href(r), no: r.no, date: dateTh(r.dt), party: partyName(r),
            kind: r.k === 'RI' ? 'ซื้อสินค้า' : 'ค่าใช้จ่าย', net: Number(r.net), vat: Number(r.vat), total: Number(r.total), status: ST[r.status] ?? r.status, dim: ['rejected', 'cancelled'].includes(r.status),
            lines: (lineMap.get(r.id) ?? []).map((l: any) => ({ d: l.d, tag: l.tag, q: l.qty != null ? Number(l.qty).toLocaleString('th-TH', { maximumFractionDigits: 4 }) : undefined, net: Number(l.net), vat: Number(l.vat) })) }))} />
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
