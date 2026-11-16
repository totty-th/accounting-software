import { currentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';
export default async function Preferences() {
  if (!(await currentUser())) redirect('/login');
  return (
    <>
      <div className="top"><div><h1>ตั้งค่าส่วนตัว</h1><p className="sub">ข้อมูลธุรกิจและการลบข้อมูล</p></div></div>
      <div className="panel" style={{ maxWidth: 560, padding: 16 }}>
        <h3 style={{ marginTop: 0 }}>การลบข้อมูลธุรกิจ</h3>
        <p>ระบบนี้ไม่มีปุ่มลบข้อมูลธุรกิจทั้งหมด เพราะรายการบัญชีลบหรือแก้ตรง ๆ ไม่ได้ตามหลักการของระบบ</p>
        <p>หากต้องการยกเลิกรายการ ให้ใช้ใบกลับรายการ (-R) ที่เอกสารนั้น ส่วนการล้างข้อมูลทดสอบหรือเริ่มต้นใหม่ ให้ติดต่อผู้ดูแลระบบ</p>
      </div>
    </>
  );
}
