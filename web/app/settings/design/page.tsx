import Link from 'next/link';
import { requirePage } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { getDb } from '@/lib/db';
import { DesignForm } from '@/components/DesignForm';
import { DESIGN_TYPES } from '@/lib/doc-design';
import { loadView } from '@/lib/doc-view';

export const dynamic = 'force-dynamic';
export default async function Design() {
  const user = await requirePage('settings.company');
  const db = await getDb();
  const rows = await db.q<any>('select scope, settings from doc_design');
  const init = Object.fromEntries(rows.map(r => [r.scope, r.settings]));
  const sample = (await db.q<any>(`select doc_no from sales_docs where doc_type='INV' order by created_at desc limit 1`))[0]?.doc_no;
  const samples: Record<string, any> = {};
  for (const [t] of DESIGN_TYPES) {
    const d = (await db.q<any>(`select id from sales_docs where doc_type=$1 order by created_at desc limit 1`, [t]))[0];
    const v = d ? await loadView(d.id) : null; if (v) samples[t] = v;
  }
  return (
    <>
      <div className="top"><div><h1>รูปแบบดีไซน์เอกสาร</h1>
        <p className="sub">ใช้กับเอกสารขาย (ใบเสนอราคา ใบแจ้งหนี้ ขายสด วางบิล ลดหนี้ เพิ่มหนี้) ทั้งหน้าพิมพ์ PDF และลิงก์แชร์ · โลโก้/ตรายางอัปโหลดที่ <Link href="/settings/company">ข้อมูลบริษัท</Link>
          {sample && <> · <Link href={`/sales/${sample}`}>ดูตัวอย่างบนเอกสารล่าสุด</Link></>}</p></div></div>
      <DesignForm init={init} canWrite={can(user.role, 'settings.company')} samples={samples} />
    </>
  );
}
