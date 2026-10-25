import { loadAging, BUCKETS, BUCKET_LABEL, type Kind, type Sp } from '@/lib/aging';
import { money, dateTh } from '@/lib/format';
import Link from 'next/link';
import { GroupHead } from '@/components/GroupHead';
import { RelPop, Dot } from '@/components/TaxBits';
import { related } from '@/lib/related';
import { getDb } from '@/lib/db';

const hrefOf = (r: any) => r.doc_type === 'EXP' ? `/expenses/${r.doc_id}` : r.doc_type === 'RI' ? `/purchases/ri/${r.doc_id}` : `/sales/${r.doc_no}`;
const m = (n: unknown) => (Number(n) ? money(n as number) : '-');
const TH_MONTH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const longDate = (iso: string) => { const [y, mo, d] = iso.split('-').map(Number); return `${d} ${TH_MONTH[mo - 1]} ${y + 543}`; };

/** รายงานลูกหนี้/เจ้าหนี้ตามเอกสาร · หน้าตาตาม FA: แถบตัวกรอง → หัวรายงาน+ยอดรวมตัวใหญ่ → ตารางกลุ่มยุบ/กางได้ ช่วงอายุแยกสี แถวรวมสีเทา */
export async function AgingReport({ kind, sp }: { kind: Kind; sp: Sp }) {
  const { asof, contact, groups, grand, contacts } = await loadAging(kind, sp);
  const db = await getDb(), allRows = groups.flatMap(g => g.rows);
  const pick = (t: string) => allRows.filter(r => r.doc_type === t).map(r => r.doc_id as string);
  const relMap = new Map<string, any[]>();
  for (const [k, ids] of [['exp', pick('EXP')], ['ri', pick('RI')], ['sales', allRows.filter(r => r.doc_type !== 'EXP' && r.doc_type !== 'RI').map(r => r.doc_id as string)]] as const)
    if (ids.length) for (const [id, v] of await related(db, k, ids)) relMap.set(id, v);
  const stMap = new Map<string, string>();
  for (const [t, ids] of [['expenses', pick('EXP')], ['goods_receipts', pick('RI')], ['sales_docs', allRows.filter(r => r.doc_type !== 'EXP' && r.doc_type !== 'RI').map(r => r.doc_id as string)]] as const)
    if (ids.length) for (const x of await db.q<any>(`select id, status from ${t} where id = any($1::uuid[])`, [`{${ids.join(',')}}`])) stMap.set(x.id, x.status);
  const codes = new Map<string, string>();
  if (groups.length) for (const x of await db.q<any>(`select id, contact_code from contacts where id = any($1::uuid[])`, [`{${groups.map(g => g.contact_id).join(',')}}`])) codes.set(x.id, x.contact_code ?? '');
  const co = (await db.q<any>('select name from company_profile limit 1'))[0]?.name ?? '';
  const ar = kind === 'ar', base = ar ? '/reports/ar' : '/reports/ap', mode = sp.mode === 'doc' ? 'doc' : 'due';
  const q = (extra: Record<string, string> = {}) => new URLSearchParams({ asof, ...(contact ? { contact } : {}), ...(mode === 'doc' ? { mode: 'doc' } : {}),
    ...(ar && sp.bl === '1' ? { bl: '1' } : {}), ...extra }).toString();
  const total = grand.outstanding;
  const sumOf = (rows: any[], k: string) => rows.reduce((a, r) => a + Number(r[k] ?? 0), 0);
  const paid = (r: any) => ar ? Number(r.collected ?? 0) : Number(r.doc_total) - Number(r.outstanding);
  const BCLS = ['b-green', 'b-sky1', 'b-sky2', 'b-sky3', 'b-blue'];
  const nm = ar ? 'ลูกค้า' : 'ผู้จำหน่าย';
  return (
    <>
      <div className="top"><div><h1>{ar ? 'รายงานลูกหนี้ตามเอกสาร' : 'รายงานเจ้าหนี้ตามเอกสาร'}</h1></div>
        <details className="xl-menu"><summary className="btn">ดาวน์โหลด Excel ▾</summary>
          <div className="xl-body"><a href={`${base}/xlsx?${q()}`}>{ar ? 'รายงานลูกหนี้ตามเอกสาร' : 'รายงานเจ้าหนี้ตามเอกสาร'}</a>
            <a href={`${base}/xlsx?${q({ coa: '1' })}`}>{ar ? 'รายงานลูกหนี้ตามเอกสารและผังบัญชี' : 'รายงานเจ้าหนี้ตามเอกสารและผังบัญชี'}</a></div></details></div>
      <form className="panel aging-filter" method="get">
        <label className="f">ณ วันที่<input type="date" name="asof" defaultValue={asof} /></label>
        <label className="f">วิเคราะห์อายุ
          <select name="mode" defaultValue={mode}><option value="due">ตามวันที่ครบกำหนด</option><option value="doc">ตามวันที่เอกสาร</option></select></label>
        <label className="f">ชื่อ{nm}
          <select name="contact" defaultValue={contact ?? ''}><option value="">แสดงทั้งหมด</option>
            {contacts.map((c: any) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
        {ar && <label className="f chk" title="แสดงรวมเฉพาะใบวางบิลที่ยังไม่ได้วางบิล/ยังไม่ได้อัปเกรดเป็นเอกสารอื่น (ไม่ลงบัญชี)">
          <span>แสดงข้อมูล</span><span className="chk-row"><input type="checkbox" name="bl" value="1" defaultChecked={sp.bl === '1'} /> แสดงเอกสารใบวางบิล/ใบแจ้งหนี้</span></label>}
        <button className="btn ghost aging-go">แสดงผลรายงาน</button>
      </form>
      <section className="panel">
        <div className="aging-head">
          <div><h2 className="aging-co">{co}</h2>
            <table className="aging-meta"><tbody>
              <tr><td>วันที่</td><td>{longDate(asof)}</td></tr><tr><td>สิ้นสุด ณ วันที่</td><td>{longDate(asof)}</td></tr></tbody></table></div>
          <div className="aging-sum"><span>{ar ? 'ยอดค้างรับ' : 'ยอดค้างจ่าย'}</span><b>{money(total)}</b></div>
        </div>
        <div className="aging-scroll">
          <table className="aging-tbl">
            <thead><tr><th>รหัส{nm}</th><th>ชื่อ{nm}</th><th>วันที่เอกสาร</th><th>วันครบกำหนด</th><th className="num">ยอดตามเอกสาร</th>
              <th className="num">{ar ? 'เก็บเงินแล้ว' : 'จ่ายเงินแล้ว'}</th><th className="num">{ar ? 'ยอดค้างรับคงเหลือ' : 'ยอดค้างจ่ายคงเหลือ'}</th>
              {BUCKET_LABEL.map((l, i) => <th key={l} className={`num ${BCLS[i]}`}>{i === 0 ? 'ยังไม่เกินกำหนด' : l.replace(' วัน', ' วัน')}</th>)}</tr></thead>
            {groups.map(g => (
              <tbody key={g.contact_id} className="grp closed">
                <GroupHead>
                  <td>{codes.get(g.contact_id)}</td>
                  <td><span className="chev" aria-hidden>▸</span> {g.name} <span className="cnt">{g.rows.length}</span></td><td></td><td></td>
                  <td className="num">{m(sumOf(g.rows, 'doc_total'))}</td><td className="num">{m(g.rows.reduce((a, r) => a + paid(r), 0))}</td>
                  <td className="num">{m(g.tot.outstanding)}</td>
                  {BUCKETS.map((b, i) => <td key={b} className={`num ${BCLS[i]}-bg`}>{m(g.tot[b])}</td>)}
                </GroupHead>
                {g.rows.map(r => (
                  <tr key={r.doc_id} className="grow"><td></td>
                    <td className="no"><Dot s={stMap.get(r.doc_id) ?? 'grey'} /><Link href={hrefOf(r)}>{r.doc_no}</Link> <RelPop rel={relMap.get(r.doc_id) ?? []} /></td>
                    <td>{dateTh(r.doc_date)}</td><td>{dateTh(r.due_date)}</td>
                    <td className="num">{m(r.doc_total)}</td><td className="num">{m(paid(r))}</td><td className="num">{m(r.outstanding)}</td>
                    {BUCKETS.map((b, i) => <td key={b} className={`num ${BCLS[i]}-bg`}>{m(r[b])}</td>)}</tr>))}
              </tbody>))}
            <tfoot><tr className="aging-total"><td></td><td>ยอดรวมสุทธิ</td><td></td><td></td>
              <td className="num">{m(sumOf(allRows, 'doc_total'))}</td><td className="num">{m(allRows.reduce((a, r) => a + paid(r), 0))}</td><td className="num">{m(total)}</td>
              {BUCKETS.map((b, i) => <td key={b} className={`num ${BCLS[i]}-bg`}>{m(grand[b])}</td>)}</tr></tfoot>
          </table>
        </div>
        {!groups.length && <p className="sub" style={{ textAlign: 'center', padding: 24 }}>ไม่พบข้อมูล ณ วันที่เลือก</p>}
      </section>
    </>
  );
}
