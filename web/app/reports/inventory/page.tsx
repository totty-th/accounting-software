import { requirePage } from '@/lib/auth';
import { getDb, today } from '@/lib/db';
import { money, qty } from '@/lib/format';
import { Group } from '@/components/Board';
import { ReportTools } from '@/components/ReportTools';

export const dynamic = 'force-dynamic';
export default async function Inventory({ searchParams }: { searchParams: { date?: string; wh?: string } }) {
  await requirePage('reports.read');
  const date = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.date ?? '') ? searchParams.date! : today();
  const db = await getDb();
  const whs = await db.q<any>(`select id, name from warehouses order by is_main desc, code`);
  const wh = whs.find(w => w.id === searchParams.wh)?.id ?? null;
  const rows = await db.q<any>(`select code, name, unit, qty::float8 q, avg_cost::float8 avg, value::float8 v from inventory_summary($1::date,$2::uuid)`, [date, wh]);
  const total = rows.reduce((s, r) => s + r.v, 0);
  return (
    <>
      <div className="top"><div><h1>รายงานสรุปสินค้าคงเหลือ</h1><p className="sub">ย้อนจากความเคลื่อนไหวสต็อก ณ วันที่เลือก · ราคาเฉลี่ย = มูลค่า ÷ จำนวน (คงเหลือติดลบ/ศูนย์ แสดง 0.00)</p></div></div>
      <form className="row-inline" method="get">
        <label className="f">ณ วันที่<input type="date" name="date" defaultValue={date} /></label>
        <label className="f">คลังสินค้า<select name="wh" defaultValue={wh ?? ''}><option value="">คลังทั้งหมด</option>{whs.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
        <button className="btn">แสดงผลรายงาน</button></form>
      <ReportTools title="รายงานสรุปสินค้าคงเหลือ" meta={[['ณ วันที่', date], ['คลังสินค้า', whs.find(w => w.id === wh)?.name ?? 'คลังทั้งหมด']]} />
      <div data-report><Group title={`สินค้าคงเหลือ ณ ${date}`} color="var(--red)" count={rows.length}>
        <table><thead><tr><th>รหัสสินค้า</th><th>ชื่อสินค้า</th><th className="num">จำนวนคงคลัง</th><th>หน่วยสินค้า</th><th className="num">ราคาเฉลี่ยต่อหน่วย</th><th className="num">มูลค่าสินค้าคงเหลือ</th></tr></thead>
          <tbody>{rows.map(r => <tr key={r.code}><td className="no">{r.code}</td><td>{r.name}</td><td className="num" style={{ color: r.q < 0 ? 'var(--red)' : undefined }}>{qty(r.q)}</td><td>{r.unit}</td><td className="num">{money(r.avg)}</td><td className="num">{money(r.v)}</td></tr>)}
            {rows.length === 0 && <tr><td colSpan={6} className="empty">ไม่มีสินค้าคงเหลือ</td></tr>}
            {rows.length > 0 && <tr style={{ fontWeight: 700 }}><td /><td>รวม</td><td /><td /><td /><td className="num">{money(total)}</td></tr>}</tbody></table>
      </Group></div>
    </>
  );
}
