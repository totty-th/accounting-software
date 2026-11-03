import Link from 'next/link';
import { requirePage } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { getDb } from '@/lib/db';
import { SForm } from '@/components/SForm';
import { saveCurrency, removeCurrency } from '@/lib/actions';

export const dynamic = 'force-dynamic';
export default async function Currency() {
  const user = await requirePage('settings.company'); const w = can(user.role, 'settings.company');
  const db = await getDb();
  const on = (await db.q<any>('select multi_currency from doc_settings'))[0].multi_currency as boolean;
  const rows = await db.q<any>('select * from currencies order by code');
  return (
    <>
      <div className="top"><div><h1>สกุลเงิน</h1><p className="sub">สกุลเงินหลักคือบาท (THB) · ทะเบียนสกุลเงินและอัตราแลกเปลี่ยน (1 หน่วย = กี่บาท) · ขณะนี้เอกสารยังบันทึกเป็นบาทเท่านั้น</p></div></div>
      {!on ? <div className="notice">ยังไม่ได้เปิดใช้งานหลายสกุลเงิน — เปิดที่ <Link href="/settings/documents">ตั้งค่าเอกสาร</Link></div> : (
        <div style={{ display: 'grid', gap: 10, maxWidth: 720 }}>
          {rows.map(r => <div key={r.code} className="panel" style={{ padding: 12 }}>
            <SForm action={saveCurrency} className="" style={{ padding: 0, gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', alignItems: 'end' }} canWrite={w}>
              <input type="hidden" name="code" value={r.code} />
              <div><b>{r.code}</b></div>
              <label>ชื่อ <input name="name" defaultValue={r.name} required /></label>
              <label>สัญลักษณ์ <input name="symbol" defaultValue={r.symbol ?? ''} /></label>
              <label>อัตรา (บาท) <input name="rate" inputMode="decimal" defaultValue={Number(r.rate)} required /></label>
              <label>สถานะ <select name="is_active" defaultValue={r.is_active ? '1' : '0'}><option value="1">ใช้งาน</option><option value="0">ไม่ใช้งาน</option></select></label>
            </SForm>
            {w && <SForm action={removeCurrency} className="" style={{ padding: 0, marginTop: 6 }} label="ลบ" danger><input type="hidden" name="code" value={r.code} /></SForm>}
          </div>)}
          {w && <div className="panel" style={{ padding: 12 }}><h3>เพิ่มสกุลเงิน</h3>
            <SForm action={saveCurrency} className="" style={{ padding: 0 }} label="เพิ่ม">
              <label>รหัส 3 ตัวอักษร (เช่น USD) <input name="code" maxLength={3} required /></label>
              <label>ชื่อ <input name="name" required /></label><label>สัญลักษณ์ <input name="symbol" /></label>
              <label>อัตรา (บาทต่อ 1 หน่วย) <input name="rate" inputMode="decimal" required /></label>
            </SForm></div>}
        </div>)}
    </>
  );
}
