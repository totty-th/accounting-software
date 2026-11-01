import Link from 'next/link';
import { requirePage } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { dateTh } from '@/lib/format';
import { ContactImportWizard } from '@/components/ContactImportWizard';
import { ActionButton } from '@/components/ActionButton';
import { deleteContactImportBatch } from '@/lib/actions';

export const dynamic = 'force-dynamic';
export default async function ImportContacts() {
  await requirePage('master.write');
  const db = await getDb();
  const existing = (await db.q<any>(`select lower(btrim(business_name)) n, coalesce(branch_code,'') b from contacts where business_name is not null`)).map(r => `${r.n}|${r.b}`);
  const hist = await db.q<any>(`select b.*, (select count(*) from contacts c where c.import_batch=b.id) alive from contact_import_batches b order by created_at desc limit 20`);
  return (
    <>
      <div className="top"><div><p className="sub"><Link href="/contacts">← สมุดรายชื่อ</Link></p><h1>นำเข้าผู้ติดต่อ</h1></div></div>
      <ContactImportWizard existing={existing} />
      {hist.length > 0 && <div className="panel" style={{ padding: 0, overflowX: 'auto', marginTop: 16 }}><h3 style={{ padding: '12px 14px 0' }}>ประวัติการนำเข้า</h3>
        <table><thead><tr><th>วันที่</th><th>ไฟล์</th><th className="num">นำเข้า</th><th className="num">ข้ามซ้ำ</th><th className="num">คงอยู่ในระบบ</th><th /></tr></thead>
          <tbody>{hist.map(h => <tr key={h.id}><td>{dateTh(h.created_at)}</td><td>{h.file_name}</td><td className="num">{h.item_count}</td><td className="num">{h.skipped_count}</td>
            <td className="num">{h.deleted_at ? 'ลบแล้ว' : h.alive}</td>
            <td>{!h.deleted_at && <ActionButton variant="danger" label="ลบทั้งชุด" confirmText="ลบรายชื่อที่นำเข้าในชุดนี้ (เฉพาะรายชื่อที่ยังไม่ถูกเอกสารอ้างอิง)" action={deleteContactImportBatch.bind(null, h.id)} />}</td></tr>)}</tbody></table></div>}
    </>
  );
}
