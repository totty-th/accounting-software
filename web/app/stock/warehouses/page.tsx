import { requirePage } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { getDb } from '@/lib/db';
import { PURPOSE } from '@/lib/stock-labels';
import { WarehouseForm, EMPTY_WH } from '@/components/WarehouseForm';
import { ActionButton } from '@/components/ActionButton';
import { setMainWarehouse, deleteWarehouse } from '@/lib/actions';

export const dynamic = 'force-dynamic';
export default async function Warehouses() {
  const user = await requirePage('stock.read');
  const rows = await (await getDb()).q<any>('select * from warehouses order by is_main desc, code');
  const w = can(user.role, 'master.write');
  const pl = Object.fromEntries(PURPOSE);
  return (
    <>
      <div className="top"><div><h1>คลังสินค้า</h1><p className="sub">สร้างคลังเพิ่มได้สูงสุด 50 คลัง (ไม่รวมคลังหลัก) · ขายผ่านช่องทางออนไลน์/POS ตัดสต็อกที่คลังหลักเสมอ</p></div>{w && <WarehouseForm label="+ สร้างใหม่" />}</div>
      <div className="panel" style={{ padding: 0, overflowX: 'auto' }}>
        <table><thead><tr><th>ชื่อคลังสินค้า</th><th>รหัส</th><th>จุดประสงค์</th><th>ที่อยู่</th><th className="num">ขั้นต่ำ</th><th></th></tr></thead>
          <tbody>{rows.map(r => <tr key={r.id}><td>{r.name}{r.is_main && <span className="pill" style={{ background: 'var(--blue)', color: '#fff', marginLeft: 8 }}>คลังหลัก</span>}</td>
            <td>{r.code}</td><td>{pl[r.purpose] ?? r.purpose}</td><td>{r.address ?? ''}</td><td className="num">{r.low_stock_min ?? '-'}</td>
            <td style={{ whiteSpace: 'nowrap' }}>{w && <><WarehouseForm label="แก้ไข" init={{ ...EMPTY_WH, id: r.id, name: r.name, code: r.code, purpose: r.purpose, address: r.address ?? '', postal: r.postal_code ?? '', contact: r.contact_name ?? '', email: r.contact_email ?? '', phone: r.contact_phone ?? '', low: r.low_stock_min == null ? '' : String(Number(r.low_stock_min)) }} />{' '}
              {!r.is_main && <ActionButton variant="ghost" label="ตั้งเป็นคลังหลัก" confirmText="ตั้งคลังนี้เป็นคลังหลัก" action={setMainWarehouse.bind(null, r.id)} />}{' '}
              {!r.is_main && <ActionButton variant="danger" label="ลบ" confirmText="ลบคลังนี้ (ลบได้เมื่อไม่มีคงเหลือและไม่เคยมีประวัติ)" action={deleteWarehouse.bind(null, r.id)} />}</>}</td></tr>)}</tbody></table>
      </div>
    </>
  );
}
