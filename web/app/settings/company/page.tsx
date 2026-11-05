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
        <label>ประเภทธุรกิจ <select name="business_type" defaultValue={c?.business_type ?? 'company'}>
          <option value="company">บริษัท</option><option value="individual">บุคคลธรรมดา</option><option value="partnership">ห้างหุ้นส่วน</option><option value="other">อื่นๆ</option></select></label>
        <label>ภาษีมูลค่าเพิ่ม <select name="vat_registered" defaultValue={c?.vat_registered === false ? 'no' : 'yes'}>
          <option value="yes">จดภาษีมูลค่าเพิ่มแล้ว</option><option value="no">ยังไม่จดภาษีมูลค่าเพิ่ม</option></select></label>
        <label>ชื่อ (ระบุสำนักงานใหญ่/สาขา) <input name="name" required defaultValue={c?.name ?? ''} /></label>
        <label>ที่อยู่ <input name="address" required defaultValue={c?.address ?? ''} /></label>
        <label>เลขประจำตัวผู้เสียภาษี 13 หลัก <input name="tax_id" required pattern="[0-9]{13}" defaultValue={c?.tax_id ?? ''} /></label>
        <label>สำนักงาน/สาขา <select name="is_branch" defaultValue={c?.is_branch ? 'branch' : 'hq'}>
          <option value="hq">สำนักงานใหญ่</option><option value="branch">สาขา</option></select></label>
        <label>รหัสสาขา 5 หลัก (เฉพาะสาขา) <input name="branch_no" pattern="[0-9]{5}" defaultValue={c?.branch_no ?? ''} /></label>
        <h3>ข้อมูลติดต่อ (แสดงบนเอกสาร)</h3>
        <label>เบอร์สำนักงาน <input name="phone" defaultValue={c?.phone ?? ''} /></label>
        <label>เบอร์มือถือ <input name="mobile" defaultValue={c?.mobile ?? ''} /></label>
        <label>เบอร์โทรสาร <input name="fax" defaultValue={c?.fax ?? ''} /></label>
        <label>เว็บไซต์ <input name="website" defaultValue={c?.website ?? ''} /></label>
        <label>อีเมล <input name="email" type="email" defaultValue={c?.email ?? ''} /></label>
        <label>ชื่อผู้มีอำนาจลงนาม (แสดงใต้ลายเซ็นบนเอกสารขายแบบแบรนด์) <input name="signer_name" defaultValue={c?.signer_name ?? ''} /></label>
        <h3>ข้อมูลภาษาอังกฤษ</h3>
        <label>ชื่อธุรกิจ (EN) <input name="name_en" defaultValue={c?.name_en ?? ''} /></label>
        <label>ที่อยู่ (EN) <input name="address_en" defaultValue={c?.address_en ?? ''} /></label>
        <button className="btn">บันทึก</button>
      </form>
      <form action={A.saveSignatures} className="panel" style={{ display: 'grid', gap: 10, padding: 16, maxWidth: 640, marginTop: 12 }}>
        <h3>ลายเซ็นอิเล็กทรอนิกส์และตรายาง</h3>
        <p className="sub">ใช้บนเอกสารซื้อที่ติ๊ก "ลายเซ็นอิเล็กทรอนิกส์และตรายาง" (ใบสั่งซื้อ) · PNG พื้นโปร่งใส/JPG ไม่เกิน 600 KB</p>
        <label>โลโก้บริษัท (แสดงบนเอกสารขาย) {c?.logo_img && <img alt="โลโก้ปัจจุบัน" src={c.logo_img} style={{ maxHeight: 48, verticalAlign: 'middle' }} />} <input type="file" name="logo" accept="image/png,image/jpeg" /></label>
        {c?.logo_img && <label><input type="checkbox" name="clear_logo" value="1" /> ลบโลโก้เดิม</label>}
        <label>ลายเซ็น {c?.signature_img && <img alt="ลายเซ็นปัจจุบัน" src={c.signature_img} style={{ maxHeight: 48, verticalAlign: 'middle' }} />} <input type="file" name="signature" accept="image/png,image/jpeg" /></label>
        {c?.signature_img && <label><input type="checkbox" name="clear_signature" value="1" /> ลบลายเซ็นเดิม</label>}
        <label>ตรายาง {c?.stamp_img && <img alt="ตรายางปัจจุบัน" src={c.stamp_img} style={{ maxHeight: 64, verticalAlign: 'middle' }} />} <input type="file" name="stamp" accept="image/png,image/jpeg" /></label>
        {c?.stamp_img && <label><input type="checkbox" name="clear_stamp" value="1" /> ลบตรายางเดิม</label>}
        <button className="btn">บันทึกรูป</button>
      </form>
    </>
  );
}
