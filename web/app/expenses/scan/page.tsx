import Link from 'next/link';
import { can } from '@/lib/permissions';
import { requirePage } from '@/lib/auth';
import { getDb, today } from '@/lib/db';
import { poFormData } from '@/lib/po-data';
import { defaultRemark, purchaseLevels } from '@/lib/doc-remarks';
import { scanEnabled } from '@/lib/modules';
import { ScanDesk } from '@/components/ScanDesk';

export const dynamic = 'force-dynamic';

/** M71 บันทึกค่าใช้จ่ายจากรูปบิล/PDF: รายการไฟล์ · ดูภาพ · ฟอร์มค่าใช้จ่าย (กรอกเอง เฟสแรก) */
export default async function ScanPage() {
  const user = await requirePage('expenses.write');
  if (!(await scanEnabled())) return (<>
    <div className="top"><div><h1>บันทึกจากรูปบิล/PDF</h1></div></div>
    <div className="panel" style={{ maxWidth: 560 }}><p>โมดูลนี้ยังปิดอยู่</p>
      {(can(user.role, 'settings.company') || can(user.role, 'payroll.write')) && <Link className="btn" href="/settings/modules">ไปที่โมดูลเสริม</Link>}</div>
  </>);
  const db = await getDb();
  const { vendors } = await poFormData();
  const accounts = (await db.q(`select code, name from accounts where type in ('expense','asset') and not is_control and code not in ('11112','11311','11319','17111','17113','17114','17120') order by code`))
    .map(a => ({ id: a.code as string, label: `${a.code} ${a.name}` }));
  const assetCats = (await db.q<any>(`select id, name from asset_categories where is_active order by sort_no`)).map(c => ({ id: c.id as string, label: c.name as string }));
  const scans = (await db.q<any>(`select s.id, s.filename, s.mime, s.size, s.created_at, u.display_name from doc_scans s left join app_users u on u.id=s.created_by
      where s.status='pending' order by s.created_at, s.id`)).map(s => ({ id: s.id as string, filename: s.filename as string, mime: s.mime as string, size: Number(s.size),
      at: new Date(s.created_at).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'short', timeStyle: 'short' }), by: (s.display_name ?? '') as string }));
  return (<>
    <div className="top"><div><h1>บันทึกจากรูปบิล/PDF</h1><p className="sub">อัปโหลดรูปหรือ PDF ของบิลที่ได้รับ แล้วกรอกข้อมูลโดยดูภาพประกอบ · บันทึกแล้วไฟล์จะผูกกับค่าใช้จ่ายนั้น</p></div>
      <div className="acts"><Link className="btn ghost" href="/expenses/scan/history">ประวัติ</Link></div></div>
    <ScanDesk scans={scans} form={{ remark: await defaultRemark('EXP'), lv: await purchaseLevels(), vendors, accounts, assetCats, today: today(),
      purchaser: user.displayName || user.username, canCreateVendor: can(user.role, 'contact.create') }} />
  </>);
}
