import { requirePage } from '@/lib/auth';
import { getDb } from '@/lib/db';
import * as A from '@/lib/actions';

export default async function Company() {
  await requirePage('settings.company');
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
      <form action={A.saveSignatures} className="panel" style={{ display: 'grid', gap: 10, padding: 16, maxWidth: 640, marginTop: 12 }}>
        <h3>ลายเซ็นอิเล็กทรอนิกส์และตรายาง</h3>
        <p className="sub">ใช้บนเอกสารซื้อที่ติ๊ก "ลายเซ็นอิเล็กทรอนิกส์และตรายาง" (ใบสั่งซื้อ) · PNG พื้นโปร่งใส/JPG ไม่เกิน 600 KB</p>
        <label>ลายเซ็น {c?.signature_img && <img alt="ลายเซ็นปัจจุบัน" src={c.signature_img} style={{ maxHeight: 48, verticalAlign: 'middle' }} />} <input type="file" name="signature" accept="image/png,image/jpeg" /></label>
        {c?.signature_img && <label><input type="checkbox" name="clear_signature" value="1" /> ลบลายเซ็นเดิม</label>}
        <label>ตรายาง {c?.stamp_img && <img alt="ตรายางปัจจุบัน" src={c.stamp_img} style={{ maxHeight: 64, verticalAlign: 'middle' }} />} <input type="file" name="stamp" accept="image/png,image/jpeg" /></label>
        {c?.stamp_img && <label><input type="checkbox" name="clear_stamp" value="1" /> ลบตรายางเดิม</label>}
        <button className="btn">บันทึกรูป</button>
      </form>
    </>
  );
}
