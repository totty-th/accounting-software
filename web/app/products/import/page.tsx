import { requirePage } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { dateTh } from '@/lib/format';
import { ImportWizard } from '@/components/ImportWizard';
import { ActionButton } from '@/components/ActionButton';
import { deleteImportBatch } from '@/lib/actions';
import Link from 'next/link';

export const dynamic = 'force-dynamic';
export default async function ImportProducts() {
  await requirePage('master.write');
  const db = await getDb();
  const whs = await db.q<any>('select id, name, is_main from warehouses order by is_main desc, code');
  const codes = (await db.q<any>('select code from products')).map(r => r.code as string);
  const hist = await db.q<any>(`select b.*, (select count(*) from products p where p.import_batch=b.id) alive from product_import_batches b order by created_at desc limit 20`);
  return (
    <>
      <div className="top"><div><p className="sub"><Link href="/products">← รายการสินค้าทั้งหมด</Link></p><h1>นำเข้ารายการสินค้า</h1></div></div>
      <ImportWizard whs={whs} existing={codes} />
      {hist.length > 0 && <div className="panel" style={{ padding: 0, overflowX: 'auto', marginTop: 16 }}><h3 style={{ padding: '12px 14px 0' }}>ประวัติการนำเข้า</h3>
        <table><thead><tr><th>วันที่</th><th>ไฟล์</th><th className="num">จำนวนที่นำเข้า</th><th className="num">คงอยู่ในระบบ</th><th /></tr></thead>
          <tbody>{hist.map(h => <tr key={h.id}><td>{dateTh(h.created_at)}</td><td>{h.file_name}</td><td className="num">{h.item_count}</td><td className="num">{h.deleted_at ? 'ลบแล้ว' : h.alive}</td>
            <td>{!h.deleted_at && <ActionButton variant="danger" label="ลบทั้งชุด" confirmText="ลบสินค้าที่นำเข้าในชุดนี้ (เฉพาะที่ยังไม่มีรายการเคลื่อนไหว)" action={deleteImportBatch.bind(null, h.id)} after="/products/import" />}</td></tr>)}</tbody></table></div>}
    </>
  );
}
