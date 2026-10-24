import { can } from '@/lib/permissions';
import { requirePage } from '@/lib/auth';
import { today } from '@/lib/db';
import { poFormData } from '@/lib/po-data';
import { PoForm } from '@/components/PoForm';

export default async function NewRi() {
  const user = await requirePage('expenses.write');
  const d = await poFormData();
  return (<>
    <div className="top"><div><h1>สร้างใบรับสินค้า</h1><p className="sub">บันทึกแล้วสินค้าเข้าสต็อกและตั้งเจ้าหนี้ทันที</p></div></div>
    <PoForm kind="RI" id={null} {...d} today={today()} purchaser={user.displayName || user.username}
      canCreateVendor={can(user.role, 'contact.create')} canCreateProduct={can(user.role, 'master.write')} />
  </>);
}
