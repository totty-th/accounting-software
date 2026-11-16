import Link from 'next/link';
import { requirePage } from '@/lib/auth';
import { payrollEnabled } from '@/lib/modules';
import { ActionButton } from '@/components/ActionButton';
import { setPayrollEnabled } from '@/lib/actions';

export const dynamic = 'force-dynamic';
export default async function Modules() {
  await requirePage('payroll.write');
  const on = await payrollEnabled();
  return (
    <>
      <div className="top"><div><h1>โมดูลเสริม</h1><p className="sub">ฟังก์ชันที่ไม่บังคับใช้ · ปิดแล้วเมนูจะถูกซ่อน ข้อมูลและรายการบัญชีที่บันทึกไว้ยังอยู่ครบ</p></div></div>
      <div className="panel" style={{ maxWidth: 640 }}>
        <h3 style={{ marginTop: 0 }}>เงินเดือน/ค่าจ้าง (Payroll) <span className={`pill ${on ? 'green' : ''}`}>{on ? 'เปิดใช้งาน' : 'ปิดอยู่'}</span></h3>
        <p className="sub">ทะเบียนพนักงาน · รายการเงินเดือนรายเดือน/ค่าจ้างรายวัน · ประกันสังคม 5% และภาษีหัก ณ ที่จ่าย 40(1) อัตโนมัติ · ลงบัญชีค้างจ่ายและจ่ายอัตโนมัติ · สลิปเงินเดือน</p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {on ? <ActionButton action={setPayrollEnabled.bind(null, false)} label="ปิดโมดูล" variant="ghost" confirmText="ปิดโมดูลเงินเดือน? (ข้อมูลไม่หาย เปิดใหม่ได้)" />
            : <ActionButton action={setPayrollEnabled.bind(null, true)} label="เปิดใช้โมดูลเงินเดือน" />}
          {on && <Link className="btn ghost sm" href="/payroll/settings">ตั้งค่าเงินเดือน</Link>}</div>
      </div>
    </>
  );
}
