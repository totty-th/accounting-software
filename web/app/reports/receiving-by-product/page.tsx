import Link from 'next/link';
import { getDb, today } from '@/lib/db';
import { money, dateTh, partyName, qty } from '@/lib/format';
import { periodRange } from '@/lib/period';
import { reportPeriod, periodLabel } from '@/lib/report-filter';
import { ReportFilter } from '@/components/ReportFilter';
import { requirePage } from '@/lib/auth';
import { ReportTools } from '@/components/ReportTools';
import { KIND_LABEL } from '@/lib/stock-labels';
import { groupByProduct, riLines } from '@/lib/purchase-reports';
import { Pill } from '@/components/Pill';

export const dynamic = 'force-dynamic';
type Sp = { period?: string; from?: string; to?: string; kind?: string; wh?: string; product?: string };
// รายงานใบรับสินค้าแยกตามสินค้า: กรองช่วงเวลา/ประเภทสินค้า/คลัง/สินค้า · กดแถวสินค้าเพื่อดูเอกสารที่รับเข้า · Excel 2 แบบ (สรุป/ละเอียด)
export default async function RiByProduct({ searchParams: sp }: { searchParams: Sp }) {
  await requirePage('reports.read');
  const period = reportPeriod(sp.period), t = today(), range = periodRange(period, t, sp.from, sp.to);
  const db = await getDb();
  const [whs, prods] = [await db.q<any>(`select id, name, is_main from warehouses order by is_main desc, name`), await db.q<any>(`select id, code, name from products order by code nulls last, name`)];
  const groups = groupByProduct(await riLines(range, { kind: sp.kind, wh: sp.wh, product: sp.product }));
  const net = groups.reduce((s, g) => s + g.net, 0), docs = new Set(groups.flatMap(g => g.rows.map(r => r.gid))).size;
  return (<>
    <div className="top"><div><h1>รายงานใบรับสินค้าแยกตามสินค้า</h1><p className="sub">มูลค่าก่อน VAT · ไม่รวมใบรับสินค้าที่ไม่อนุมัติ/ยกเลิก · กดชื่อสินค้าเพื่อดูเอกสาร</p></div></div>
    <ReportFilter period={period} from={sp.from} to={sp.to} selects={[
      { name: 'kind', label: 'ประเภทสินค้า', value: sp.kind ?? '', options: [['', 'ประเภททั้งหมด'], ...Object.entries(KIND_LABEL)] },
      { name: 'wh', label: 'คลังสินค้า', value: sp.wh ?? '', options: [['', 'คลังทั้งหมด'], ...whs.map((w: any) => [w.id, w.name] as [string, string])] },
      { name: 'product', label: 'สินค้า', value: sp.product ?? '', options: [['', 'สินค้าทั้งหมด'], ...prods.map((p: any) => [p.id, `${p.code ? p.code + ' ' : ''}${p.name}`] as [string, string])] }]} />
    <ReportTools exportBase="/reports/receiving-by-product/export" modes={[['summary', 'Excel (สรุป)'], ['detail', 'Excel (แบบละเอียด)']]} title="รายงานใบรับสินค้าแยกตามสินค้า" meta={[['ช่วงเวลา :', periodLabel(range)]]} />
    <section className="panel" style={{ padding: 16, marginBottom: 12, display: 'flex', flexWrap: 'wrap', gap: 24, justifyContent: 'space-between' }}>
      <div><div className="sub">ช่วงเวลา</div><b>{periodLabel(range)}</b><div className="sub" style={{ marginTop: 6 }}>จำนวนทั้งหมด</div><b>{docs} เอกสาร · {groups.length} สินค้า</b></div>
      <div><div className="sub">ยอดรวมก่อนภาษี</div><b style={{ fontSize: 22 }}>{money(net)}</b></div></section>
    {groups.length === 0 ? <div className="empty">ไม่มีข้อมูลในช่วงที่เลือก</div> : <div className="panel" style={{ padding: 0, overflowX: 'auto' }}>
      <table style={{ minWidth: 760 }}><thead><tr><th>สินค้า / เลขที่เอกสาร</th><th>ผู้จำหน่าย / คลัง</th><th className="num">จำนวน</th><th className="num">ราคาต่อหน่วย</th><th className="num">มูลค่าก่อนภาษี</th></tr></thead></table>
      {groups.map(g => (
        <details key={g.id} className="rbp">
          <summary><span>{g.code && <b>{g.code} </b>}{g.name}<small className="sub"> · {KIND_LABEL[g.kind] ?? g.kind}{g.cat ? ` · ${g.cat}` : ''}</small></span>
            <span className="num">{qty(g.qty)} {g.unit}</span><span className="num">{g.qty ? money(g.net / g.qty) : '-'}</span><span className="num"><b>{money(g.net)}</b></span></summary>
          <table style={{ minWidth: 760 }}><tbody>{g.rows.map(r => (
            <tr key={r.ri_id + '-' + r.line_no}><td className="no"><Link href={`/purchases/ri/${r.gid}`}>{r.ri_no}</Link> <small className="sub">{dateTh(r.ri_date)}</small> <Pill s={r.status} /></td>
              <td>{partyName(r)} <small className="sub">· {r.wh_name}</small></td><td className="num">{qty(r.qty)} {r.unit_name}</td><td className="num">{money(r.unit_price)}</td><td className="num">{money(r.net)}</td></tr>))}</tbody></table>
        </details>))}
    </div>}
  </>);
}
