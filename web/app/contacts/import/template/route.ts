import ExcelJS from 'exceljs';
import { apiUser } from '@/lib/auth';
import { send } from '@/lib/fa-xlsx';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /contacts/import/template → ไฟล์ตัวอย่างนำเข้าผู้ติดต่อ (คอลัมน์จำเป็น 3 ช่อง + คอลัมน์เพิ่มเติม)
export async function GET() {
  const au = await apiUser('master.write'); if (au instanceof Response) return au;
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Contacts');
  ws.addRow(['ชื่อธุรกิจ', 'ประเภทผู้ติดต่อ', 'ประเภทกิจการ', 'รหัสผู้ติดต่อ', 'ชื่อผู้ติดต่อ', 'ที่อยู่', 'รหัสไปรษณีย์', 'เลขผู้เสียภาษี', 'สาขา', 'เบอร์โทร', 'อีเมล', 'เครดิต (วัน)', 'บัญชีธนาคาร', 'โน้ต']).font = { bold: true };
  ws.addRow(['บริษัท ตัวอย่าง จำกัด', 'ลูกค้า', 'นิติบุคคล', 'C-001', 'คุณสมชาย', '1 ถนนตัวอย่าง กรุงเทพฯ', '10110', '0105500000001', 'สำนักงานใหญ่', '021234567', 'a@example.com', 30, '', '']);
  ws.addRow(['นายตัวอย่าง ใจดี', 'ผู้จำหน่าย', 'บุคคลธรรมดา', '', '', '', '', '', '', '0812345678', '', 0, '', '']);
  ws.columns.forEach(c => { c.width = 22; });
  return send(wb, 'เทมเพลตนำเข้าผู้ติดต่อ');
}
