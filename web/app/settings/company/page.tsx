import { getDb } from '@/lib/db';
import * as A from '@/lib/actions';

export default async function Company() {
  const c = (await (await getDb()).q('select * from company_profile'))[0];
  return (
    <>
      <div className="top"><div><h1>ข้อมูลบริษัทผู้จ่าย</h1><p className="sub">ใช้เป็นผู้มีหน้าที่หักภาษี ณ ที่จ่ายในหนังสือรับรอง 50 ทวิ</p></div></div>
      <form action={A.saveCompany} className="panel" style={{ display: 'grid', gap: 10, padding: 16, maxWidth: 640 }}>
        <label>ชื่อ (ระบุสำนักงานใหญ่/สาขา) <input name="name" required defaultValue={c?.name ?? ''} /></label>
        <label>ที่อยู่ <input name="address" required defaultValue={c?.address ?? ''} /></label>
        <label>เลขประจำตัวผู้เสียภาษี 13 หลัก <input name="tax_id" required pattern="[0-9]{13}" defaultValue={c?.tax_id ?? ''} /></label>
        <button className="btn">บันทึก</button>
      </form>
    </>
  );
}
