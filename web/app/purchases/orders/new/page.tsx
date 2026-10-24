import { can } from '@/lib/permissions';
import { requirePage } from '@/lib/auth';
import { today } from '@/lib/db';
import { poFormData } from '@/lib/po-data';
import { PoForm } from '@/components/PoForm';

export default async function NewPo() {
  const user = await requirePage('expenses.write');
  const d = await poFormData();
  return (<>
    <div className="top"><div><h1>สร้างใบสั่งซื้อ</h1><p className="sub">ไม่ลงบัญชีและไม่ขยับสต็อก · สร้างใบรับสินค้าจากใบสั่งซื้อเมื่อสินค้ามาถึง</p></div></div>
    <PoForm id={null} {...d} today={today()} purchaser={user.displayName || user.username}
      canCreateVendor={can(user.role, 'contact.create')} canCreateProduct={can(user.role, 'master.write')} />
  </>);
}
