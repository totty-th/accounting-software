import Link from 'next/link';
import { requirePage } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { enabledModules } from '@/lib/modules';
import { ActionButton } from '@/components/ActionButton';
import { setPayrollEnabled, setModuleEnabled } from '@/lib/actions';

export const dynamic = 'force-dynamic';
export default async function Modules() {
  const user = await requirePage(['payroll.write', 'settings.company']);
  const mods = await enabledModules();
  const pay = mods.includes('payroll'), scan = mods.includes('scan');
  const canPay = can(user.role, 'payroll.write');
  const pill = (on: boolean) => <span className={`pill ${on ? 'green' : ''}`}>{on ? 'เปิดใช้งาน' : 'ปิดอยู่'}</span>;
  return (
    <>
      <div className="top"><div><h1>โมดูลเสริม</h1><p className="sub">ฟังก์ชันที่ไม่บังคับใช้ · ปิดแล้วเมนูจะถูกซ่อน ข้อมูลและรายการบัญชีที่บันทึกไว้ยังอยู่ครบ</p></div></div>
      <div style={{ display: 'grid', gap: 14, maxWidth: 640 }}>
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>เงินเดือน/ค่าจ้าง (Payroll) {pill(pay)}</h3>
          <p className="sub">ทะเบียนพนักงาน · รายการเงินเดือนรายเดือน/ค่าจ้างรายวัน · ประกันสังคม 5% และภาษีหัก ณ ที่จ่าย 40(1) อัตโนมัติ · ลงบัญชีค้างจ่ายและจ่ายอัตโนมัติ · สลิปเงินเดือน</p>
          {canPay ? <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {pay ? <ActionButton action={setPayrollEnabled.bind(null, false)} label="ปิดโมดูล" variant="ghost" confirmText="ปิดโมดูลเงินเดือน? (ข้อมูลไม่หาย เปิดใหม่ได้)" />
              : <ActionButton action={setPayrollEnabled.bind(null, true)} label="เปิดใช้โมดูลเงินเดือน" />}
            {pay && <Link className="btn ghost sm" href="/payroll/settings">ตั้งค่าเงินเดือน</Link>}</div>
            : <p className="sub">ต้องมีสิทธิ์จัดการเงินเดือนจึงเปิด-ปิดได้</p>}
        </div>
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>บันทึกค่าใช้จ่ายจากรูปบิล/PDF {pill(scan)}</h3>
          <p className="sub">อัปโหลดรูปถ่ายหรือ PDF ของบิลที่ได้รับ (หลายไฟล์พร้อมกัน) · ดูภาพคู่กับฟอร์มค่าใช้จ่ายขณะกรอก · บันทึกแล้วไฟล์ผูกกับเอกสารค่าใช้จ่าย · มีหน้าประวัติ
            <br />ตอนนี้ยังเป็นการกรอกเอง ระบบอ่านข้อมูลจากภาพอัตโนมัติจะต่อในเฟสถัดไป</p>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {scan ? <ActionButton action={setModuleEnabled.bind(null, 'scan', false)} label="ปิดโมดูล" variant="ghost" confirmText="ปิดโมดูลบันทึกจากรูปบิล? (ไฟล์และค่าใช้จ่ายที่บันทึกไว้ไม่หาย)" />
              : <ActionButton action={setModuleEnabled.bind(null, 'scan', true)} label="เปิดใช้โมดูลนี้" />}
            {scan && <Link className="btn ghost sm" href="/expenses/scan">ไปหน้าบันทึก</Link>}</div>
        </div>
      </div>
    </>
  );
}
