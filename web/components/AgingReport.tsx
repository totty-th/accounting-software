import { loadAging, accountsOf, BUCKETS, BUCKET_LABEL, type Kind, type Sp } from '@/lib/aging';
import { money, dateTh } from '@/lib/format';
import { Fragment } from 'react';
import { Group } from '@/components/Board';
import Link from 'next/link';
import { RelPop } from '@/components/TaxBits';
import { related } from '@/lib/related';
import { getDb } from '@/lib/db';

const hrefOf = (r: any) => r.doc_type === 'EXP' ? `/expenses/${r.doc_id}` : r.doc_type === 'RI' ? `/purchases/ri/${r.doc_id}` : `/sales/${r.doc_no}`;

export async function AgingReport({ kind, sp }: { kind: Kind; sp: Sp }) {
  const { asof, contact, groups, grand, contacts, count } = await loadAging(kind, sp);
  const db = await getDb(), allRows = groups.flatMap(g => g.rows);
  const pick = (t: string) => allRows.filter(r => r.doc_type === t).map(r => r.doc_id as string);
  const relMap = new Map<string, any[]>();
  for (const [k, ids] of [['exp', pick('EXP')], ['ri', pick('RI')], ['sales', allRows.filter(r => r.doc_type !== 'EXP' && r.doc_type !== 'RI').map(r => r.doc_id as string)]] as const)
    if (ids.length) for (const [id, v] of await related(db, k, ids)) relMap.set(id, v);
  const coa = sp.coa === '1', accs = coa ? accountsOf(kind) : [];
  const ar = kind === 'ar', base = ar ? '/reports/ar' : '/reports/ap';
  const qs = new URLSearchParams({ asof, ...(contact ? { contact } : {}), ...(coa ? { coa: '1' } : {}) }).toString();
  return (
    <>
      <div className="top"><div><h1>{ar ? 'ลูกหนี้ตามเอกสาร' : 'เจ้าหนี้ตามเอกสาร'}</h1>
        <p className="sub">นับอายุจากวันครบกำหนด เทียบกับวันที่ที่เลือก{ar ? ' · ใบเสร็จที่ยังไม่รับเงินไม่ลดยอดค้าง' : ''}</p></div></div>
      <form className="row-inline" method="get">
        <label className="f">ณ วันที่<input type="date" name="asof" defaultValue={asof} /></label>
        <label className="f">{ar ? 'ลูกค้า' : 'ผู้ขาย'}
          <select name="contact" defaultValue={contact ?? ''}><option value="">ทั้งหมด</option>
            {contacts.map((c: any) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
        <label className="f" style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 6, flexDirection: 'row' }}>
          <input type="checkbox" name="coa" value="1" defaultChecked={coa} style={{ width: 'auto' }} /> แยกตามบัญชี</label>
        <button className="btn">ดูรายงาน</button>
        <a className="btn" href={`${base}/xlsx?${qs}`}>ส่งออก Excel</a>
      </form>
      <Group title={`${ar ? 'ลูกหนี้' : 'เจ้าหนี้'} ณ ${dateTh(asof)}`} color={ar ? 'var(--green)' : 'var(--purple)'} count={count}>
        <table><thead><tr><th>เลขที่</th><th>วันที่</th><th>ครบกำหนด</th><th className="num">ยอดรวม</th>{ar && <th className="num">รับแล้ว</th>}
          <th className="num">ค้างชำระ</th>{BUCKET_LABEL.map(l => <th key={l} className="num">{l}</th>)}{accs.map(a => <th key={a[0]} className="num">{a[0]} {a[1]}</th>)}</tr></thead>
          <tbody>
            {groups.map(g => (
              <Fragment key={g.contact_id}>
                <tr style={{ fontWeight: 700 }}><td colSpan={(ar ? 11 : 10) + accs.length}>{g.name}</td></tr>
                {g.rows.map(r => (
                  <tr key={r.doc_id}><td className="no"><Link href={hrefOf(r)}>{r.doc_no}</Link> <RelPop rel={relMap.get(r.doc_id) ?? []} /></td><td>{dateTh(r.doc_date)}</td><td>{dateTh(r.due_date)}</td>
                    <td className="num">{money(r.doc_total)}</td>{ar && <td className="num">{money(r.receipted)}</td>}
                    <td className="num">{money(r.outstanding)}</td>{BUCKETS.map(b => <td key={b} className="num">{Number(r[b]) ? money(r[b]) : ''}</td>)}{accs.map(a => <td key={a[0]} className="num">{Number(r[a[0]]) ? money(r[a[0]]) : ''}</td>)}</tr>))}
                <tr style={{ fontWeight: 600 }}><td colSpan={ar ? 5 : 4}>รวม {g.name}</td><td className="num">{money(g.tot.outstanding)}</td>
                  {BUCKETS.map(b => <td key={b} className="num">{money(g.tot[b])}</td>)}{accs.map(a => <td key={a[0]} className="num">{money(g.tot[a[0]])}</td>)}</tr>
              </Fragment>))}
            <tr style={{ fontWeight: 700 }}><td colSpan={ar ? 5 : 4}>รวมทั้งสิ้น</td><td className="num">{money(grand.outstanding)}</td>
              {BUCKETS.map(b => <td key={b} className="num">{money(grand[b])}</td>)}{accs.map(a => <td key={a[0]} className="num">{money(grand[a[0]])}</td>)}</tr>
          </tbody></table>
      </Group>
    </>
  );
}
