import Link from 'next/link';
import { requirePage } from '@/lib/auth';

const SECTIONS: [string, [string, string, string][]][] = [
  ['ธุรกิจและเอกสาร', [['/settings/company', 'ข้อมูลธุรกิจ', 'ประเภทธุรกิจ จด VAT สำนักงานใหญ่/สาขา ช่องทางติดต่อ โลโก้ ตรายาง'], ['/settings/design', 'รูปแบบดีไซน์เอกสาร', 'ธีมและรูปแบบเอกสาร'], ['/settings/documents', 'ตั้งค่าเอกสาร', 'ราคา/VAT/ส่วนลด/หัก ณ ที่จ่าย คลังสินค้า'], ['/settings/remarks', 'หมายเหตุเอกสาร', 'หมายเหตุตั้งต้นท้ายเอกสาร เลือกทั้งหมดหรือแยกตามชนิด'], ['/settings/numbering', 'เลขที่เอกสาร', 'คำนำหน้า วันที่ ลำดับ การรีเซ็ต'], ['/settings/payment-info', 'ข้อมูลการรับชำระ', 'บัญชีโอน เช็ค QR ท้ายเอกสาร'], ['/settings/currency', 'สกุลเงิน', 'ทะเบียนสกุลเงินและอัตรา']]],
  ['บัญชี', [['/settings/fiscal-period', 'งวดบัญชี', 'เดือนสิ้นงวด วันที่เริ่มจัดตั้งบริษัท'], ['/settings/lock', 'ล็อกงวดบัญชี', 'ป้องกันการแก้ไขย้อนหลัง'], ['/settings/opening-balance', 'ยอดเริ่มต้น', 'ยอดยกมา'], ['/settings/close-year', 'ปิดงบบัญชี', 'ปิดรายได้/ค่าใช้จ่ายสิ้นปี']]],
  ['สินค้าและผู้ใช้', [['/stock/settings', 'ตั้งค่าสต็อก', 'ขายติดลบ สินค้าใกล้หมด'], ['/admin/users', 'ผู้ใช้และสิทธิ์', 'จัดการผู้ใช้งาน']]],
  ['อื่นๆ', [['/settings/my-signature', 'ลายเซ็นของฉัน', 'อัปโหลดลายเซ็นของคุณ ใช้บนเอกสารขายที่คุณสร้าง'], ['/settings/shortcuts', 'แป้นพิมพ์ลัด', 'รายการทางลัดคีย์บอร์ด']]],
];
export default async function Settings() {
  await requirePage('reports.read');
  return (
    <>
      <div className="top"><div><h1>ตั้งค่า</h1></div></div>
      {SECTIONS.map(([h, items]) => <section key={h} style={{ marginBottom: 16 }}><h3>{h}</h3>
        <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))' }}>
          {items.map(([href, t, d]) => <Link key={href} href={href} className="panel" style={{ padding: 12 }}><b>{t}</b><br /><span className="sub">{d}</span></Link>)}
        </div></section>)}
    </>
  );
}
