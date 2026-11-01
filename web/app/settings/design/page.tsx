import Link from 'next/link';
import { requirePage } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { getDb } from '@/lib/db';
import { DesignForm } from '@/components/DesignForm';

export const dynamic = 'force-dynamic';
export default async function Design() {
  const user = await requirePage('settings.company');
  const db = await getDb();
  const rows = await db.q<any>('select scope, settings from doc_design');
  const init = Object.fromEntries(rows.map(r => [r.scope, r.settings]));
  const sample = (await db.q<any>(`select doc_no from sales_docs where doc_type='INV' order by created_at desc limit 1`))[0]?.doc_no;
  return (
    <>
      <div className="top"><div><h1>รูปแบบดีไซน์เอกสาร</h1>
        <p className="sub">ใช้กับเอกสารขาย (ใบเสนอราคา ใบแจ้งหนี้ ขายสด วางบิล ลดหนี้ เพิ่มหนี้) ทั้งหน้าพิมพ์ PDF และลิงก์แชร์ · โลโก้/ตรายางอัปโหลดที่ <Link href="/settings/company">ข้อมูลบริษัท</Link>
          {sample && <> · <Link href={`/sales/${sample}`}>ดูตัวอย่างบนเอกสารล่าสุด</Link></>}</p></div></div>
      <DesignForm init={init} canWrite={can(user.role, 'settings.company')} />
    </>
  );
}
