import Link from 'next/link';
import { requirePage } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { getDb } from '@/lib/db';
import { saveStockSettings } from '@/lib/actions';

export const dynamic = 'force-dynamic';
export default async function StockSettings() {
  const user = await requirePage('stock.read');
  const [s] = await (await getDb()).q<any>('select * from stock_settings');
  const w = can(user.role, 'master.write');
  return (
    <>
      <div className="top"><div><p className="sub"><Link href="/stock">← สต็อก</Link></p><h1>ตั้งค่าสต็อก</h1></div></div>
      <form action={saveStockSettings} className="panel" style={{ display: 'grid', gap: 12, maxWidth: 640 }}>
        <h3>การขายสินค้าเมื่อคงเหลือไม่พอ (ขายติดลบ)</h3>
        <p className="sub">ใช้กับเอกสารขายเท่านั้น (ใบแจ้งหนี้/ขายสด/ใบลดหนี้/ใบเพิ่มหนี้) · การปรับยอดและโอนสินค้าใช้กฎ "ห้ามติดลบ" ของแต่ละสินค้า</p>
        {([['allow', 'อนุญาตให้ขายติดลบ', 'บันทึกได้ทันที สต็อกติดลบและขึ้นรายการแจ้งเตือน'], ['warn', 'แจ้งเตือนก่อนขาย', 'ขึ้นเตือนตอนบันทึก ต้องกดยืนยันอีกครั้งจึงขายได้'], ['block', 'ไม่อนุญาตให้ขายติดลบ', 'บันทึกไม่ได้ถ้าคงเหลือไม่พอ']] as const).map(([v, l, d]) =>
          <label key={v}><input type="radio" name="negative_sales" value={v} defaultChecked={s.negative_sales === v} disabled={!w} /> <b>{l}</b><br /><span className="sub" style={{ marginLeft: 22 }}>{d}</span></label>)}
        <h3>สินค้าใกล้หมด</h3>
        <label><input type="checkbox" name="low_stock_enabled" value="1" defaultChecked={s.low_stock_enabled} disabled={!w} /> เปิดแจ้งเตือนสินค้าใกล้หมด (ตั้งจำนวนขั้นต่ำที่หน้าคลังสินค้า)</label>
        {w && <button className="btn">บันทึก</button>}
      </form>
    </>
  );
}
