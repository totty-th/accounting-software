import Link from 'next/link';
import { can } from '@/lib/permissions';
import { requirePage } from '@/lib/auth';
import { getDb, today } from '@/lib/db';
import { money, dateTh } from '@/lib/format';
import { ASSET_STATUS, depRows, num, sum } from '@/lib/assets';
import { PostDepButton } from '@/components/DepPost';

export default async function Dep({ searchParams: sp }: { searchParams: { year?: string; tab?: string } }) {
  const user = await requirePage('expenses.read');
  const W = can(user.role, 'expenses.write');
  const y = Number(sp.year) || Number(today().slice(0, 4)), tab = sp.tab === 'posted' ? 'posted' : 'calc';
  const rows = await depRows(`${y}-01-01`, `${y}-12-31`);
  const plan = await (await getDb()).q<any>('select * from asset_dep_plan($1::int)', [y]);
  const cats = [...new Set(rows.map(r => r.cat_name))];
  const nav = (n: number, t = tab) => `/assets/depreciation?year=${n}&tab=${t}`;
  return (<>
    <div className="top"><div><h1>บันทึกค่าเสื่อมราคา</h1><p className="sub">ค่าเสื่อม = ค่าเสื่อม/ปี × จำนวนวันที่ใช้ ÷ 365 · ลงบัญชีรายเดือน (JV วันสิ้นเดือน) ทุกเดือนของปี · ถ้าข้อมูลสินทรัพย์เปลี่ยน ระบบกลับรายการ (-R) ใบเดิมแล้วลงใหม่ให้เอง</p></div>
      <div className="acts"><Link className="btn sm ghost" href="/assets">รายการสินทรัพย์</Link></div></div>
    <div className="row-inline" style={{ alignItems: 'center' }}>
      <Link className="btn sm ghost" href={nav(y - 1)}>◀</Link><b style={{ fontSize: 18 }}>ปี {y + 543} ({y})</b><Link className="btn sm ghost" href={nav(y + 1)}>▶</Link>
      <Link className={`btn sm ${tab === 'calc' ? '' : 'ghost'}`} href={nav(y, 'calc')}>ตารางคำนวณค่าเสื่อมราคา</Link>
      <Link className={`btn sm ${tab === 'posted' ? '' : 'ghost'}`} href={nav(y, 'posted')}>บันทึกบัญชีค่าเสื่อมราคา</Link>
    </div>
    {tab === 'calc' ? <>
      <div className="cards" style={{ marginBottom: 12 }}>
        <div className="card kpi" style={{ ['--c' as any]: 'var(--blue)' }}><span>จำนวนสินทรัพย์</span><b>{rows.length} รายการ</b></div>
        <div className="card kpi" style={{ ['--c' as any]: 'var(--orange)' }}><span>ค่าเสื่อมราคารวมของงวด</span><b>{money(sum(rows, 'dep'))}</b></div>
        <div className="card kpi" style={{ ['--c' as any]: 'var(--green)' }}><span>ราคาตามบัญชีใหม่รวม</span><b>{money(sum(rows, 'book_out'))}</b></div>
      </div>
      <div className="acts" style={{ justifyContent: 'flex-start', marginBottom: 10 }}>
        <a className="btn sm ghost" href={`/assets/depreciation/xlsx?year=${y}`}>⬇ ดาวน์โหลดเป็น Excel</a>{W && <PostDepButton year={y} />}</div>
      {rows.length === 0 ? <div className="empty">ไม่พบสินทรัพย์ที่ต้องคิดค่าเสื่อมในปีนี้</div> : <div data-report>{cats.map(c => { const g = rows.filter(r => r.cat_name === c); return (
        <section key={c} className="panel" style={{ marginBottom: 12, overflowX: 'auto' }}>
          <h3 style={{ padding: '10px 14px 0' }}>{c} <small className="sub">{g.length} รายการ</small></h3>
          <table style={{ minWidth: 980 }}><thead><tr><th>รหัส</th><th>ชื่อสินทรัพย์</th><th>วันเริ่มใช้งาน</th><th className="num">ราคาซื้อ</th><th className="num">ค่าเสื่อมสะสมยกมา</th><th className="num">ราคาตามบัญชียกมา</th>
            <th className="num">ค่าเสื่อม/ปี %</th><th className="num">จำนวนวัน</th><th className="num">ค่าเสื่อมของงวด</th><th className="num">ราคาตามบัญชีใหม่</th><th>สถานะ</th></tr></thead>
            <tbody>{g.map(r => <tr key={r.id}><td className="no"><Link href={`/assets/${r.id}`}>{r.code}</Link></td><td>{r.name}</td><td>{dateTh(r.start)}</td><td className="num">{money(r.cost)}</td><td className="num">{money(r.accum_in)}</td>
              <td className="num">{money(r.book_in)}</td><td className="num">{num(r.rate).toFixed(2)}%</td><td className="num">{r.days}</td><td className="num">{money(r.dep)}</td><td className="num">{money(r.book_out)}</td>
              <td>{ASSET_STATUS[r.status]?.[0]}{r.disp && ` ${dateTh(r.disp)}`}</td></tr>)}
              <tr data-group style={{ fontWeight: 700 }}><td /><td>ยอดรวม</td><td /><td className="num">{money(sum(g, 'cost'))}</td><td className="num">{money(sum(g, 'accum_in'))}</td><td className="num">{money(sum(g, 'book_in'))}</td><td /><td /><td className="num">{money(sum(g, 'dep'))}</td><td className="num">{money(sum(g, 'book_out'))}</td><td /></tr></tbody></table>
        </section>); })}</div>}
    </> : <section className="panel" style={{ overflowX: 'auto' }}>
      <table><thead><tr><th>ลำดับ</th><th>วันที่</th><th>เลขที่เอกสาร</th><th>คำอธิบาย</th><th className="num">ยอดค่าเสื่อม</th><th className="num">ยอดที่ควรเป็น</th></tr></thead>
        <tbody>{plan.map((p: any, i: number) => { const diff = Math.abs(num(p.expected) - num(p.posted)) > 0.004; return (
          <tr key={i}><td>{i + 1}</td><td>{p.voucher_date ? dateTh(p.voucher_date) : '-'}</td><td className="no">{p.voucher_no ?? '-'}</td>
            <td>{p.voucher_id ? `บันทึกรายการค่าเสื่อมสำหรับงวด ${String(i + 1).padStart(2, '0')}-${y}` : num(p.expected) > 0 ? <span style={{ color: 'var(--orange)' }}>ยังไม่ได้บันทึกบัญชี</span> : 'ไม่พบสินทรัพย์ที่ต้องคิดค่าเสื่อมในเดือนนี้'}</td>
            <td className="num">{money(p.posted)}</td><td className="num" style={diff ? { color: 'var(--red)', fontWeight: 700 } : undefined}>{money(p.expected)}</td></tr>); })}</tbody></table>
    </section>}
  </>);
}
