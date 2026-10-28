import ExcelJS from 'exceljs';
import { apiUser } from '@/lib/auth';
import { send } from '@/lib/fa-xlsx';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /products/import/template?type=basic|advanced → ไฟล์ตัวอย่างสำหรับนำเข้า
export async function GET(req: Request) {
  const au = await apiUser('master.write'); if (au instanceof Response) return au;
  const adv = new URL(req.url).searchParams.get('type') === 'advanced';
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Products');
  const head = adv
    ? ['ประเภทสินค้า', 'รหัสสินค้า', 'ชื่อสินค้า', 'หน่วยสินค้าหลัก', 'หมวดสินค้า', 'เลขบาร์โค้ด', 'รายละเอียดสินค้า', 'ราคาขาย', 'ภาษีมูลค่าเพิ่ม (ขาย)', 'ราคาซื้อ', 'ภาษีมูลค่าเพิ่ม (ซื้อ)', 'หน่วยสินค้าอื่น', 'อัตราแปลง', 'ราคาขาย (หน่วยอื่น)', 'ราคาซื้อ (หน่วยอื่น)', 'จำนวนยอดตั้งต้น', 'ต้นทุนต่อหน่วย (ยอดตั้งต้น)', 'วันที่ตั้งต้น']
    : ['ประเภทสินค้า', 'รหัสสินค้า', 'ชื่อสินค้า', 'หน่วยสินค้าหลัก', 'หมวดสินค้า', 'เลขบาร์โค้ด', 'รายละเอียดสินค้า', 'ราคาขาย', 'ภาษีมูลค่าเพิ่ม (ขาย)', 'ราคาซื้อ', 'ภาษีมูลค่าเพิ่ม (ซื้อ)'];
  ws.addRow(head).font = { bold: true };
  ws.addRow(['บริการ', 'SV-001', 'ค่าขนส่ง', '', '', '', '', 500, 'ราคายังไม่รวม VAT']);
  ws.addRow(['สินค้าไม่นับสต็อก', 'NS-001', 'กระดาษ A4', 'รีม', 'เครื่องเขียน', '', '', 120, 'ราคายังไม่รวม VAT', 95, 'ราคายังไม่รวม VAT']);
  if (adv) {
    ws.addRow(['สินค้านับสต็อก', 'TP-001', 'แผ่นตะแกรงเหล็ก P20', 'แผ่น', 'ตะแกรงเจาะรู', '', '', 1850, 'ราคายังไม่รวม VAT', 1400, 'ราคายังไม่รวม VAT', 'มัด', 10, 18000, 13500, 50, 1380, '27/10/2569']);
    ws.addRow(['สินค้านับสต็อก', 'TP-001', 'แผ่นตะแกรงเหล็ก P20', 'แผ่น', 'ตะแกรงเจาะรู', '', '', 1850, 'ราคายังไม่รวม VAT', 1400, 'ราคายังไม่รวม VAT', 'พาเลท', 100]);
  }
  ws.columns.forEach(c => { c.width = 22; });
  return send(wb, adv ? 'เทมเพลตนำเข้าสินค้า_ขั้นสูง' : 'เทมเพลตนำเข้าสินค้า_พื้นฐาน');
}
