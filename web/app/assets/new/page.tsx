import { requirePage } from '@/lib/auth';
import { today } from '@/lib/db';
import { assetCats } from '@/lib/assets';
import { AssetForm } from '@/components/AssetForm';

export default async function NewAsset() {
  await requirePage('expenses.write');
  const cats = (await assetCats()).filter(c => c.is_active).map(c => ({ id: c.id, name: c.name, depreciate: c.depreciate, life_years: c.life_years ? Number(c.life_years) : null }));
  return (<>
    <div className="top"><div><h1>เพิ่มสินทรัพย์ยกมา</h1><p className="sub">บันทึกทะเบียนสินทรัพย์ที่มีอยู่แล้ว — ไม่ลงบัญชีตอนบันทึก (ยอดสินทรัพย์ยกมาตั้งที่ยอดเริ่มต้น) · สินทรัพย์ที่ซื้อใหม่ให้บันทึกผ่านค่าใช้จ่าย</p></div></div>
    <AssetForm cats={cats} today={today()} />
  </>);
}
