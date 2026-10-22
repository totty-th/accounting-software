import { getDb } from '@/lib/db';
import { money } from '@/lib/format';
import { Group } from '@/components/Board';
import { QuickAdd } from '@/components/QuickAdd';
import { createProduct } from '@/lib/actions';

const KIND: Record<string, [string, string]> = { service: ['บริการ', 'var(--purple)'], goods_nostock: ['สินค้าไม่นับสต็อก', 'var(--orange)'], goods_stock: ['สินค้านับสต็อก', 'var(--blue)'] };
export default async function Products() {
  const rows = await (await getDb()).q(`select * from products order by code`);
  return (
    <>
      <div className="top"><div><h1>สินค้าและบริการ</h1></div>
        <QuickAdd label="เพิ่มสินค้า" action={createProduct} fields={[
          { name: 'code', label: 'รหัส' }, { name: 'name', label: 'ชื่อ' },
          { name: 'kind', label: 'ชนิด', type: 'select', options: [['goods_stock', 'สินค้านับสต็อก'], ['goods_nostock', 'สินค้าไม่นับสต็อก'], ['service', 'บริการ']] },
          { name: 'unit', label: 'หน่วย' }, { name: 'sale', label: 'ราคาขาย', type: 'number' }, { name: 'buy', label: 'ราคาซื้อ', type: 'number' }]} /></div>
      <Group title="รายการทั้งหมด" color="var(--blue)" count={rows.length}>
        <table><thead><tr><th>รหัส</th><th>ชื่อ</th><th>ชนิด</th><th>หน่วย</th><th className="num">ราคาขาย</th><th className="num">ราคาซื้อ</th></tr></thead>
          <tbody>{rows.map(r => (
            <tr key={r.id}><td className="no">{r.code}</td><td>{r.name}</td>
              <td><span className="pill" style={{ background: KIND[r.kind][1], color: '#fff', minWidth: 130 }}>{KIND[r.kind][0]}</span></td>
              <td>{r.base_unit}</td><td className="num">{money(r.sale_price)}</td><td className="num">{money(r.purchase_price)}</td></tr>))}</tbody></table>
      </Group>
    </>
  );
}
