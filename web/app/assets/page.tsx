import Link from 'next/link';
import { can } from '@/lib/permissions';
import { requirePage } from '@/lib/auth';
import { today } from '@/lib/db';
import { money, dateTh } from '@/lib/format';
import { ASSET_STATUS, assetCats, listAssets, num, sum } from '@/lib/assets';
import { AssetStatusBtn } from '@/components/AssetForm';

export default async function Assets({ searchParams: sp }: { searchParams: { q?: string; status?: string; cat?: string; from?: string; to?: string; asof?: string } }) {
  const user = await requirePage('expenses.read');
  const W = can(user.role, 'expenses.write');
  const asof = /^\d{4}-\d{2}-\d{2}$/.test(sp.asof ?? '') ? sp.asof! : today();
  const [rows, cats] = [await listAssets({ ...sp, asof }), await assetCats()];
  const groups = cats.map(c => ({ c, rs: rows.filter(r => r.category_id === c.id) })).filter(g => g.rs.length);
  const live = rows.filter(r => !['sold', 'disposed'].includes(r.status));
  const qs = new URLSearchParams({ asof, ...(sp.status ? { status: sp.status } : {}), ...(sp.cat ? { cat: sp.cat } : {}), ...(sp.q ? { q: sp.q } : {}) });
  return (
    <>
      <div className="top"><div><h1>รายการสินทรัพย์</h1><p className="sub">ทะเบียนสินทรัพย์ถาวร มูลค่าทางบัญชี ณ {dateTh(asof)} · ซื้อผ่านเอกสารค่าใช้จ่ายแล้วเลือกหมวดสินทรัพย์ ระบบสร้างให้เอง</p></div>
        <div className="acts">
          <a className="btn sm ghost" href={`/assets/xlsx?${qs}`}>⬇ ดาวน์โหลด Excel</a>
          <Link className="btn sm ghost" href="/assets/depreciation">บันทึกค่าเสื่อมราคา</Link>
          <Link className="btn sm ghost" href="/assets/categories">หมวดหมู่สินทรัพย์</Link>
          {W && <Link className="btn" href="/assets/new">+ เพิ่มสินทรัพย์ยกมา</Link>}</div></div>
      <div className="cards" style={{ marginBottom: 12 }}>
        <div className="card kpi" style={{ ['--c' as any]: 'var(--blue)' }}><span>สินทรัพย์ที่ใช้งานอยู่</span><b>{live.length} รายการ</b></div>
        <div className="card kpi" style={{ ['--c' as any]: 'var(--purple)' }}><span>ราคาซื้อรวม</span><b>{money(sum(live, 'cost'))}</b></div>
        <div className="card kpi" style={{ ['--c' as any]: 'var(--green)' }}><span>มูลค่าทางบัญชีรวม</span><b>{money(sum(live, 'book'))}</b></div>
      </div>
      <form className="row-inline" method="get">
        <label className="f">ค้นหา<input name="q" defaultValue={sp.q} placeholder="รหัส / ชื่อ / ผู้จำหน่าย / ซีเรียล" /></label>
        <label className="f">เริ่มใช้งานตั้งแต่<input type="date" name="from" defaultValue={sp.from} /></label>
        <label className="f">ถึง<input type="date" name="to" defaultValue={sp.to} /></label>
        <label className="f">ณ วันที่<input type="date" name="asof" defaultValue={asof} /></label>
        <label className="f">สถานะ<select name="status" defaultValue={sp.status ?? ''}><option value="">ทั้งหมด</option><option value="in_use">ใช้งานอยู่</option><option value="suspended">พักการใช้งาน</option><option value="sold">ขาย</option><option value="sold_group">เลิกใช้แล้ว (ขาย/บริจาค/ทำลาย)</option></select></label>
        <label className="f">หมวดหมู่<select name="cat" defaultValue={sp.cat ?? ''}><option value="">ทั้งหมด</option>{cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <button className="btn">กรอง</button>
      </form>
      {rows.length === 0 ? <div className="empty">ยังไม่มีสินทรัพย์ที่ตรงเงื่อนไข</div> : groups.map(({ c, rs }) => (
        <section key={c.id} className="panel" style={{ marginBottom: 12, overflowX: 'auto' }}>
          <h3 style={{ padding: '10px 14px 0' }}>{c.name} <small className="sub">{rs.length} รายการ</small></h3>
          <table><thead><tr><th>รหัส</th><th>ชื่อสินทรัพย์</th><th>วันที่เริ่มใช้งาน</th><th className="num">ราคาซื้อ</th><th className="num">มูลค่าทางบัญชี</th><th>สถานะ</th><th /></tr></thead>
            <tbody>{rs.map(r => (
              <tr key={r.id}><td className="no"><Link href={`/assets/${r.id}`}>{r.code}</Link></td>
                <td>{r.name}{r.exp_no && <small className="sub"> · จาก <Link href={`/expenses/${r.expense_id}`}>{r.exp_no}</Link></small>}</td>
                <td>{dateTh(r.start)}</td><td className="num">{money(r.cost)}</td><td className="num">{money(r.book)}</td>
                <td><span className={`pill ${ASSET_STATUS[r.status]?.[1] ?? 'grey'}`}>{ASSET_STATUS[r.status]?.[0]}</span>{r.disp && <small className="sub"> {dateTh(r.disp)}</small>}</td>
                <td className="acts">{W && ['in_use', 'suspended'].includes(r.status) && <AssetStatusBtn id={r.id} status={r.status} />}
                  <Link className="btn sm ghost" href={`/assets/${r.id}`}>เปิด</Link></td></tr>))}
              <tr style={{ fontWeight: 700 }}><td /><td>ยอดรวม {c.name}</td><td /><td className="num">{money(sum(rs, 'cost'))}</td><td className="num">{money(sum(rs, 'book'))}</td><td /><td /></tr></tbody></table>
        </section>))}
      {rows.length > 0 && <p className="sub">รวมทั้งสิ้น {rows.length} รายการ · ราคาซื้อ {money(rows.reduce((s, r) => s + num(r.cost), 0))}</p>}
    </>
  );
}
