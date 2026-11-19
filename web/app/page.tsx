import { requirePage } from '@/lib/auth';
import Link from 'next/link';
import { getDb, today } from '@/lib/db';
import { money, dateTh, partyName } from '@/lib/format';
import { periodRange } from '@/lib/period';
import { Pill } from '@/components/Pill';
import { DOC_TYPE } from '@/lib/status';
import { Columns, HBars, Spark, Ring, Stack, monLabel, type Bar } from '@/components/Charts';

const PERIODS: [string, string][] = [['month', 'เดือนปัจจุบัน'], ['lastmonth', 'เดือนก่อน'], ['m3', '3 เดือนที่แล้ว'], ['m6', '6 เดือนที่แล้ว'], ['year', 'ปีปัจจุบัน'], ['lastyear', 'ปีก่อน'], ['custom', 'กำหนดเอง']];
const VIEWS: [string, string][] = [['all', 'ภาพรวม'], ['sales', 'ขาย/รายได้'], ['cost', 'ค่าใช้จ่าย'], ['cash', 'เงินสด/ลูกหนี้/เจ้าหนี้'], ['tax', 'ภาษี/ปิดงวด']];
const N = (v: unknown) => Number(v ?? 0);
const pct = (cur: number, prev: number) => (prev === 0 ? null : ((cur - prev) / Math.abs(prev)) * 100);
const addMonths = (ym: string, k: number) => { const t = Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1 + k; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`; };
const BUCKETS: [string, string][] = [['not_due', 'ยังไม่ถึงกำหนด'], ['d1_30', 'เกิน 1–30 วัน'], ['d31_60', 'เกิน 31–60 วัน'], ['d61_90', 'เกิน 61–90 วัน'], ['over90', 'เกิน 90 วัน']];
const RAMP = ['var(--dv-1)', 'var(--dv-r1)', 'var(--dv-r2)', 'var(--dv-r3)', 'var(--dv-r4)'];

export default async function Home({ searchParams }: { searchParams: { p?: string; from?: string; to?: string; v?: string } }) {
  await requirePage('dash.view');
  const db = await getDb();
  const t = today();
  const p = PERIODS.some(x => x[0] === searchParams.p) ? searchParams.p! : 'month';
  const v = VIEWS.some(x => x[0] === searchParams.v) ? searchParams.v! : 'all';
  const [from, to] = periodRange(p, t, searchParams.from, searchParams.to) ?? periodRange('month', t)!;
  const asof = to < t ? to : t;
  const show = (k: string) => v === 'all' || v === k;
  const href = (o: Record<string, string | undefined>) => {
    const q = new URLSearchParams(); const m = { p, v, ...(p === 'custom' ? { from, to } : {}), ...o };
    for (const [k, x] of Object.entries(m)) if (x && !(k === 'v' && x === 'all') && !(k === 'p' && x === 'month')) q.set(k, x);
    const s = q.toString(); return s ? `/?${s}` : '/';
  };

  // ---------- ตัวเลขหลัก: ช่วงที่เลือก เทียบช่วงก่อนหน้าที่ยาวเท่ากัน ----------
  const pl = async (a: string, b: string) => (await db.q(`
    select coalesce(sum(case when section='revenue' then amount end),0) rev, coalesce(sum(case when section='expense' then amount end),0) exp
      from income_statement($1::date,$2::date)`, [a, b]))[0];
  const cur = await pl(from, to);
  const pv = (await db.q(`select ($1::date - ($2::date - $1::date + 1))::text pf, ($1::date - 1)::text pt`, [from, to]))[0];
  const prev = await pl(pv.pf, pv.pt);
  const rev = N(cur.rev), exp = N(cur.exp), profit = rev - exp;
  const prevProfit = N(prev.rev) - N(prev.exp);

  // ---------- กราฟรายเดือน ----------
  let m0 = from.slice(0, 7), m1 = to.slice(0, 7);
  const span = () => (Number(m1.slice(0, 4)) * 12 + Number(m1.slice(5, 7))) - (Number(m0.slice(0, 4)) * 12 + Number(m0.slice(5, 7))) + 1;
  if (span() < 6) m0 = addMonths(m1, -5);
  if (span() > 12) m0 = addMonths(m1, -11);
  const months: string[] = []; for (let m = m0; m <= m1; m = addMonths(m, 1)) months.push(m);
  const mrows = await db.q(`
    select to_char(v.voucher_date,'YYYY-MM') m,
           coalesce(sum(case when a.type='revenue' then l.credit-l.debit end),0) rev,
           coalesce(sum(case when a.type='expense' then l.debit-l.credit end),0) exp
      from journal_lines l join journal_vouchers v on v.id=l.voucher_id join accounts a on a.id=l.account_id
     where a.type in ('revenue','expense') and v.voucher_type<>'CP' and v.voucher_date between ($1||'-01')::date and ($2||'-01')::date + interval '1 month' - interval '1 day'
     group by 1`, [m0, m1]);
  const mm = new Map(mrows.map(r => [r.m, r]));
  const revS = months.map(m => N(mm.get(m)?.rev)), expS = months.map(m => N(mm.get(m)?.exp));

  // ---------- ขาย ----------
  const topItems = await db.q(`
    select l.description label, sum(l.amount) value from sales_doc_lines l join sales_docs d on d.id=l.doc_id
     where d.doc_type in ('INV','CA') and d.status<>'cancelled' and d.doc_date between $1 and $2 group by 1 order by 2 desc`, [from, to]);
  const topCust = await db.q(`
    select contact_label(d.contact_id) label, sum(d.subtotal) value from sales_docs d
     where d.doc_type in ('INV','CA') and d.status<>'cancelled' and d.doc_date between $1 and $2 group by d.contact_id order by 2 desc limit 6`, [from, to]);
  const inv = (await db.q(`
    select coalesce(sum(total),0) billed, count(*) n from sales_docs where doc_type in ('INV','CA') and status<>'cancelled' and doc_date between $1 and $2`, [from, to]))[0];
  const rc = (await db.q(`
    select coalesce(sum(amount) filter (where status='collected' and coalesce(collected_date,receipt_date) between $1 and $2),0) got,
           coalesce(sum(amount) filter (where status='pending'),0) pend from receipts`, [from, to]))[0];
  const fold = (rows: any[], n: number): Bar[] => {
    const head = rows.slice(0, n).map(r => ({ label: String(r.label), value: N(r.value) }));
    const rest = rows.slice(n).reduce((a, r) => a + N(r.value), 0);
    return rest > 0 ? [...head, { label: 'อื่น ๆ', value: rest, color: 'var(--dv-other)' }] : head;
  };

  // ---------- ค่าใช้จ่าย ----------
  const cats = await db.q(`
    select coalesce(nullif(btrim(el.category),''), a.name, el.account_code) label, sum(el.net) value
      from expense_lines el join expenses e on e.id=el.expense_id left join accounts a on a.code=el.account_code
     where e.status<>'cancelled' and e.exp_date between $1 and $2 group by 1 order by 2 desc`, [from, to]);
  const topVend = await db.q(`
    select contact_label(e.contact_id) label, sum(e.subtotal) value from expenses e
     where e.status<>'cancelled' and e.exp_date between $1 and $2 group by e.contact_id order by 2 desc limit 5`, [from, to]);
  const expPay = (await db.q(`
    select coalesce(sum(total) filter (where status in ('pending','approved')),0) unpaid,
           coalesce(sum(total) filter (where status='paid' and paid_date between $1 and $2),0) paid from expenses`, [from, to]))[0];

  // ---------- เงินสด/ลูกหนี้/เจ้าหนี้ (ณ วันนี้หรือวันสิ้นสุดช่วง) ----------
  const cashRows = await db.q(`select code, name, closing from trial_balance($1::date,$1::date,false) where code like '111%' order by code`, [asof]);
  const cashTotal = cashRows.reduce((a, r) => a + N(r.closing), 0);
  const ag = async (fn: 'ar_aging' | 'ap_aging') => {
    const r = (await db.q(`select coalesce(sum(not_due),0) not_due, coalesce(sum(d1_30),0) d1_30, coalesce(sum(d31_60),0) d31_60,
      coalesce(sum(d61_90),0) d61_90, coalesce(sum(over90),0) over90, count(*) n from ${fn}($1::date)`, [asof]))[0];
    const items: Bar[] = BUCKETS.map(([k, l], i) => ({ label: l, value: N(r[k]), color: RAMP[i] }));
    const total = items.reduce((a, b) => a + b.value, 0);
    return { items, total, over: total - N(r.not_due), n: N(r.n) };
  };
  const [ar, ap] = await Promise.all([ag('ar_aging'), ag('ap_aging')]);
  const topDebtor = await db.q(`select contact_name label, sum(outstanding) value from ar_aging($1::date) group by contact_name order by 2 desc limit 5`, [asof]);

  // ---------- ภาษี/ปิดงวด/งานค้าง ----------
  const pm = (await db.q(`select date_trunc('month', $1::date - interval '1 month')::date::text m`, [t]))[0].m as string;
  const pp30 = (await db.q(`select status, result, amount, paid_date from pp30_filings where period_month=$1::date and status='filed'`, [pm]))[0];
  const wht = await db.q(`select form_code, sum(wht_amount) amt, count(*) n from wht_certs where status='active' and pay_date between $1::date and ($1::date + interval '1 month' - interval '1 day') group by 1 order by 1`, [pm]);
  const lock = (await db.q(`select max(date_to)::text d from period_locks where released_at is null`))[0].d as string | null;
  const todo = (await db.q(`
    select (select count(*) from sales_docs where doc_type='INV' and status in ('awaiting_payment','split_paid')) inv,
           (select count(*) from receipts where status='pending') re,
           (select count(*) from expenses where status in ('pending','approved')) ex,
           (select count(*) from sales_docs where doc_type='QT' and status='pending_approval') qt,
           (select count(*) from stock_alerts) alerts`))[0];
  const recent = await db.q(`select d.id, d.doc_type, d.doc_no, d.doc_date, d.status_view status, d.total, c.business_name, c.contact_name
     from sales_docs d join contacts c on c.id=d.contact_id order by d.created_at desc limit 6`);

  type Alert = { lv: 'bad' | 'warn' | 'ok'; text: string; href?: string };
  const alerts: Alert[] = [];
  if (ar.over > 0) alerts.push({ lv: 'bad', text: `ลูกหนี้เกินกำหนดชำระ ${money(ar.over)} บาท`, href: '/reports/ar' });
  if (cashTotal < 0) alerts.push({ lv: 'bad', text: `เงินสดและเงินฝากติดลบ ${money(cashTotal)} บาท ตรวจรายการจ่ายเงิน`, href: '/reports/trial-balance' });
  if (!pp30) alerts.push({ lv: 'warn', text: `ยังไม่ยื่น ภ.พ.30 ของเดือน ${monLabel(pm)}`, href: '/tax/filings?form=30' });
  else if (pp30.result === 'payable' && !pp30.paid_date) alerts.push({ lv: 'warn', text: `ภ.พ.30 ${monLabel(pm)} ยื่นแล้ว รอชำระ ${money(pp30.amount)} บาท`, href: '/tax/filings?form=30' });
  for (const w of wht) alerts.push({ lv: 'warn', text: `หัก ณ ที่จ่าย ${monLabel(pm)} (${w.form_code}) ${money(w.amt)} บาท ${w.n} ฉบับ ตรวจการนำส่ง`, href: '/wht' });
  if (N(todo.qt) > 0) alerts.push({ lv: 'warn', text: `ใบเสนอราคารออนุมัติ ${todo.qt} ใบ`, href: '/sales?type=QT' });
  if (N(todo.alerts) > 0) alerts.push({ lv: 'warn', text: `ขายสินค้าเกินคงเหลือ ${todo.alerts} ครั้ง`, href: '/stock' });
  if (!lock || lock < pm.slice(0, 7) + '-01') alerts.push({ lv: 'ok', text: lock ? `ล็อกงวดถึง ${dateTh(lock)}` : 'ยังไม่ได้ล็อกงวดบัญชี', href: '/settings/lock' });
  else alerts.push({ lv: 'ok', text: `ล็อกงวดถึง ${dateTh(lock)}`, href: '/settings/lock' });
  const ICON = { bad: '✖ ต้องแก้', warn: '▲ ติดตาม', ok: '✔ ปกติ' } as const;
  const margin = rev > 0 ? (profit / rev) * 100 : null;

  // ---------- ส่วนแสดงผล ----------
  const Big = ({ v }: { v: number }) => { const [i, d] = money(v).split('.'); return <>{i}<small>.{d}</small></>; };
  const Delta = ({ cur: c, prev: q, good = 'up' }: { cur: number; prev: number; good?: 'up' | 'down' }) => {
    const d = pct(c, q); if (d == null || !isFinite(d)) return <span className="db-delta flat">ไม่มีช่วงก่อนหน้าให้เทียบ</span>;
    const flat = Math.abs(d) < 0.05, up = d > 0, ok = good === 'up' ? up : !up;
    return <span className={`db-delta ${flat ? 'flat' : ok ? 'ok' : 'bad'}`}>{flat ? '▬ เท่าเดิม' : `${up ? '▲' : '▼'} ${Math.abs(d).toFixed(1)}%`}<small> เทียบช่วงก่อนหน้า</small></span>;
  };
  const profS = revS.map((r, i) => r - expS[i]);
  const flowMax = Math.max(rev, exp, 1);
  const net = cashTotal + ar.total - ap.total;
  const collectPct = N(inv.billed) > 0 ? (N(rc.got) / N(inv.billed)) * 100 : null;
  const TODO: [string, string, number, string][] = [['ใบแจ้งหนี้รอเก็บเงิน', '/sales?type=INV', N(todo.inv), 'var(--dv-1)'], ['ใบเสร็จรอเก็บเงิน', '/receipts', N(todo.re), 'var(--dv-3)'],
    ['ค่าใช้จ่ายรอจ่าย', '/expenses', N(todo.ex), 'var(--dv-2)'], ['ใบเสนอราคารออนุมัติ', '/sales?type=QT', N(todo.qt), 'var(--dv-5)']];
  const AL_ICON = { bad: '!', warn: '▲', ok: '✓' } as const;
  const AlertList = ({ list }: { list: Alert[] }) => (
    <ul className="db-alerts">{list.map((a, i) => { const body = <><i aria-hidden>{AL_ICON[a.lv]}</i><span><b>{ICON[a.lv].slice(2)}</b>{a.text}</span>{a.href && <em aria-hidden>→</em>}</>;
      return <li key={i} className={a.lv}>{a.href ? <Link href={a.href}>{body}</Link> : <div>{body}</div>}</li>; })}</ul>);

  return (
    <div className="dash">
      <div className="db-head">
        <div><h1>ภาพรวมบริษัท</h1><p className="sub">{dateTh(from)} – {dateTh(to)} · เทียบกับ {dateTh(pv.pf)} – {dateTh(pv.pt)}</p></div>
        <div className="db-seg noprint" role="group" aria-label="ช่วงเวลา">{PERIODS.map(([k, l]) => <Link key={k} className={p === k ? 'on' : ''} href={href({ p: k })}>{l}</Link>)}</div>
      </div>
      {p === 'custom' && (
        <form method="get" className="row-inline noprint" style={{ marginBottom: 12 }}><input type="hidden" name="p" value="custom" />{v !== 'all' && <input type="hidden" name="v" value={v} />}
          <label className="f">เริ่มต้น<input type="date" name="from" defaultValue={from} required /></label>
          <label className="f">สิ้นสุด<input type="date" name="to" defaultValue={to} required /></label>
          <button className="btn" type="submit">แสดงผล</button></form>)}
      <nav className="db-tabs noprint" aria-label="เลือกหัวข้อ">{VIEWS.map(([k, l]) => <Link key={k} className={v === k ? 'on' : ''} href={href({ v: k })}>{l}</Link>)}</nav>

      {/* ---------- แถวเด่น: ผลประกอบการ + สภาพคล่อง ---------- */}
      <div className="db-row hero">
        <section className={`db-hero${profit < 0 ? ' loss' : ''}`}>
          <div className="db-hero-l">
            <span className="db-eyebrow">{profit >= 0 ? 'กำไรสุทธิ' : 'ขาดทุนสุทธิ'}</span>
            <b className="db-hero-v"><Big v={profit} /><em>บาท</em></b>
            <Delta cur={profit} prev={prevProfit} />
            {margin != null && <span className="db-hero-m">อัตรากำไร <b>{margin.toFixed(1)}%</b> ของรายได้</span>}
            <Spark values={profS} color="#ffffff" label="แนวโน้มกำไรรายเดือน" />
            <span className="db-hero-cap">กำไร(ขาดทุน)รายเดือน {monLabel(months[0])} – {monLabel(months[months.length - 1])}</span>
          </div>
          <div className="db-flow" role="img" aria-label={`รายได้ ${money(rev)} หักค่าใช้จ่าย ${money(exp)} เหลือ ${money(profit)}`}>
            {([['รายได้', rev, 'rev', ''], ['ค่าใช้จ่าย', exp, 'exp', '−'], [profit >= 0 ? 'กำไร' : 'ขาดทุน', Math.abs(profit), profit >= 0 ? 'ok' : 'bad', '=']] as const).map(([l, val, cls, op]) => (
              <div key={l} className="db-flow-r"><span className="op" aria-hidden>{op}</span>
                <div><div className="lb"><span>{l}</span><b>{money(cls === 'bad' ? -val : val)}</b></div>
                  <div className="tk"><div className={cls} style={{ width: `${Math.max(val > 0 ? 2 : 0, (val / flowMax) * 100)}%` }} /></div></div></div>))}
          </div>
        </section>
        <section className="db-card db-liq">
          <h2>สภาพคล่อง <small>ณ {dateTh(asof)}</small></h2>
          <Link href="/bank" className="r"><span>เงินสดและเงินฝาก</span><b className={cashTotal < 0 ? 'neg' : ''}>{money(cashTotal)}</b></Link>
          <Link href="/reports/ar" className="r"><span><i className="op plus">+</i>ลูกหนี้ค้างรับ <small>{ar.n} ใบ</small></span><b>{money(ar.total)}</b></Link>
          <Link href="/reports/ap" className="r"><span><i className="op minus">−</i>เจ้าหนี้ค้างจ่าย <small>{ap.n} ใบ</small></span><b>{money(ap.total)}</b></Link>
          <div className="t"><span>คงเหลือสุทธิ<small>ถ้าเก็บและจ่ายหนี้ครบทุกใบ</small></span><b className={net < 0 ? 'neg' : 'pos'}><Big v={net} /></b></div>
        </section>
      </div>

      {/* ---------- ตัวเลขหลัก 4 ช่อง ---------- */}
      <div className="db-row four">
        <section className="db-card db-tile"><span className="db-eyebrow"><i style={{ background: 'var(--dv-1)' }} />รายได้</span>
          <b className="v"><Big v={rev} /></b><Delta cur={rev} prev={N(prev.rev)} />
          <Spark values={revS} color="var(--dv-1)" label="แนวโน้มรายได้รายเดือน" /><span className="cap">ใบแจ้งหนี้/ขายสด {inv.n} ใบ</span></section>
        <section className="db-card db-tile"><span className="db-eyebrow"><i style={{ background: 'var(--dv-2)' }} />ค่าใช้จ่าย</span>
          <b className="v"><Big v={exp} /></b><Delta cur={exp} prev={N(prev.exp)} good="down" />
          <Spark values={expS} color="var(--dv-2)" label="แนวโน้มค่าใช้จ่ายรายเดือน" /><span className="cap">รอจ่าย {money(expPay.unpaid)}</span></section>
        <Link href="/reports/ar" className="db-card db-tile"><span className="db-eyebrow"><i style={{ background: 'var(--dv-r2)' }} />ลูกหนี้ค้างรับ</span>
          <b className="v"><Big v={ar.total} /></b>
          <span className={`db-delta ${ar.over > 0 ? 'bad' : 'ok'}`}>{ar.over > 0 ? `เกินกำหนด ${money(ar.over)}` : 'ไม่มียอดเกินกำหนด'}</span>
          <Stack items={ar.items} legend={false} empty="" /><span className="cap">{ar.total > 0 ? `เกินกำหนด ${((ar.over / ar.total) * 100).toFixed(0)}% ของยอดค้าง` : 'ไม่มียอดค้างรับ'}</span></Link>
        <Link href="/reports/ap" className="db-card db-tile"><span className="db-eyebrow"><i style={{ background: 'var(--dv-5)' }} />เจ้าหนี้ค้างจ่าย</span>
          <b className="v"><Big v={ap.total} /></b>
          <span className={`db-delta ${ap.over > 0 ? 'bad' : 'ok'}`}>{ap.over > 0 ? `เกินกำหนด ${money(ap.over)}` : 'ไม่มียอดเกินกำหนด'}</span>
          <Stack items={ap.items} legend={false} empty="" /><span className="cap">{ap.total > 0 ? `เกินกำหนด ${((ap.over / ap.total) * 100).toFixed(0)}% ของยอดค้าง` : 'ไม่มียอดค้างจ่าย'}</span></Link>
      </div>

      {v === 'all' && (
        <div className="db-row two">
          <section className="db-card"><h2>ประเด็นที่ควรติดตาม <small>{alerts.filter(a => a.lv !== 'ok').length} เรื่อง</small></h2><AlertList list={alerts} /></section>
          <section className="db-card"><h2>งานค้าง</h2>
            <div className="db-todo">{TODO.map(([l, h, n, c]) => <Link key={l} href={h} className={n > 0 ? 'has' : ''} style={{ ['--c' as any]: c }}><b>{n}</b><span>{l}</span></Link>)}</div></section>
        </div>)}

      {(show('sales') || show('cost')) && (
        <div className={`db-row ${v === 'all' || v === 'sales' ? 'wide' : 'one'}`}>
          <section className="db-card">
            <h2>รายได้ ค่าใช้จ่าย และกำไร รายเดือน</h2>
            <Columns labels={months.map(monLabel)} series={[{ key: 'r', name: 'รายได้', color: 'var(--dv-1)', values: revS }, { key: 'e', name: 'ค่าใช้จ่าย', color: 'var(--dv-2)', values: expS }]}
              line={{ key: 'p', name: 'กำไร(ขาดทุน)', color: 'var(--dv-3)', values: profS }} />
            <details className="dv-table"><summary>ดูเป็นตาราง</summary>
              <table><thead><tr><th>เดือน</th><th className="num">รายได้</th><th className="num">ค่าใช้จ่าย</th><th className="num">กำไร(ขาดทุน)</th></tr></thead>
                <tbody>{months.map((m, i) => <tr key={m}><td>{monLabel(m)}</td><td className="num">{money(revS[i])}</td><td className="num">{money(expS[i])}</td><td className="num">{money(revS[i] - expS[i])}</td></tr>)}</tbody></table></details>
          </section>
          {(v === 'all' || v === 'sales') && (
            <section className="db-card db-collect"><h2>การเก็บเงิน <small>ในช่วงนี้</small></h2>
              <Ring pct={collectPct} color="var(--dv-3)" caption="เก็บแล้ว" />
              <ul className="db-kv">
                <li><span><i style={{ background: 'var(--dv-1)' }} />ออกใบแจ้งหนี้/ขายสด</span><b>{money(inv.billed)}</b></li>
                <li><span><i style={{ background: 'var(--dv-3)' }} />เก็บเงินแล้ว</span><b>{money(rc.got)}</b></li>
                <li><span><i style={{ background: 'var(--dv-4)' }} />ใบเสร็จรอเก็บเงิน (ทั้งหมด)</span><b>{money(rc.pend)}</b></li></ul>
              <p className="dv-foot"><Link href="/receipts">ไปหน้าใบเสร็จ →</Link></p></section>)}
        </div>)}

      <div className="db-row three">
        {show('sales') && <>
          <section className="db-card"><h2>สินค้า/บริการขายดี <small>ก่อน VAT</small></h2><HBars items={fold(topItems, 5)} /></section>
          <section className="db-card"><h2>ลูกค้ารายใหญ่ <small>ก่อน VAT</small></h2><HBars items={topCust.map(r => ({ label: String(r.label), value: N(r.value) }))} color="var(--dv-3)" /></section>
        </>}
        {show('cost') && <>
          <section className="db-card"><h2>ค่าใช้จ่ายตามหมวด <small>ก่อน VAT</small></h2><HBars items={fold(cats, 5)} color="var(--dv-2)" /></section>
          {v === 'cost' && <>
            <section className="db-card"><h2>ผู้จำหน่ายที่จ่ายมากสุด</h2><HBars items={topVend.map(r => ({ label: String(r.label), value: N(r.value) }))} color="var(--dv-5)" /></section>
            <section className="db-card"><h2>สรุปการจ่ายเงิน</h2>
              <HBars showPct={false} items={[{ label: 'จ่ายแล้วในช่วงนี้', value: N(expPay.paid), color: 'var(--dv-3)' }, { label: 'ค่าใช้จ่ายรอจ่าย (ทั้งหมด)', value: N(expPay.unpaid), color: 'var(--dv-2)' }]} />
              <p className="dv-foot"><Link href="/expenses">ไปหน้าค่าใช้จ่าย →</Link></p></section></>}
        </>}
        {v === 'cash' && <>
          <section className="db-card"><h2>เงินสดและเงินฝากแต่ละบัญชี</h2>
            {cashRows.length === 0 ? <div className="empty sm">ไม่มีข้อมูล</div> : <table className="dv-mini"><tbody>
              {cashRows.map(r => <tr key={r.code}><td>{r.name} <small>{r.code}</small></td><td className={`num${N(r.closing) < 0 ? ' neg' : ''}`}>{money(r.closing)}</td></tr>)}
              <tr className="tot"><td>รวม</td><td className="num">{money(cashTotal)}</td></tr></tbody></table>}</section>
          <section className="db-card"><h2>อายุลูกหนี้ค้างรับ</h2><Stack items={ar.items} empty="ไม่มียอดลูกหนี้ค้าง" /></section>
          <section className="db-card"><h2>อายุเจ้าหนี้ค้างจ่าย</h2><Stack items={ap.items} empty="ไม่มียอดเจ้าหนี้ค้าง" /></section>
          <section className="db-card"><h2>ลูกหนี้ค้างสูงสุด</h2><HBars items={topDebtor.map(r => ({ label: String(r.label), value: N(r.value) }))} color="var(--dv-r2)" empty="ไม่มียอดลูกหนี้ค้าง" /></section>
        </>}
        {v === 'tax' && <>
          <section className="db-card"><h2>สถานะภาษีและการล็อกงวด</h2><AlertList list={alerts.filter(a => /ภ\.พ\.|หัก ณ|ล็อก/.test(a.text))} /></section>
          <section className="db-card"><h2>งานค้าง</h2>
            <div className="db-todo">{TODO.map(([l, h, n, c]) => <Link key={l} href={h} className={n > 0 ? 'has' : ''} style={{ ['--c' as any]: c }}><b>{n}</b><span>{l}</span></Link>)}</div></section>
        </>}
      </div>

      {v === 'all' && (
        <section className="db-card db-recent"><h2>เอกสารขายล่าสุด <small><Link href="/sales">ดูทั้งหมด →</Link></small></h2>
          {recent.length === 0 ? <div className="empty">ยังไม่มีเอกสาร</div> : (
            <div style={{ overflowX: 'auto' }}><table><thead><tr><th>เลขที่</th><th>ประเภท</th><th>ลูกค้า</th><th>วันที่</th><th className="num">ยอดรวม</th><th>สถานะ</th></tr></thead>
              <tbody>{recent.map(r => (
                <tr key={r.id}><td className="no"><Link href={`/sales/${r.doc_no}`}>{r.doc_no}</Link></td><td>{DOC_TYPE[r.doc_type]}</td><td>{partyName(r)}</td>
                  <td>{dateTh(r.doc_date)}</td><td className="num">{money(r.total)}</td><td><Pill s={r.status} /></td></tr>))}</tbody></table></div>)}
        </section>)}
    </div>
  );
}
