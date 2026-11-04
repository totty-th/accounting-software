import { requirePage } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { getDb } from '@/lib/db';
import { RemarksForm } from '@/components/RemarksForm';

export const dynamic = 'force-dynamic';
export default async function Remarks() {
  const user = await requirePage('settings.company');
  const r = (await (await getDb()).q<any>('select remarks from doc_settings'))[0]?.remarks ?? {};
  return (
    <>
      <div className="top"><div><h1>หมายเหตุเอกสาร</h1>
        <p className="sub">ข้อความหมายเหตุตั้งต้นท้ายเอกสาร เติมให้อัตโนมัติเมื่อสร้างเอกสารใหม่ (แก้ในแต่ละเอกสารได้อีกครั้ง)</p></div></div>
      <RemarksForm init={r} canWrite={can(user.role, 'settings.company')} />
    </>
  );
}
