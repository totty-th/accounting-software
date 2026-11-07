import Link from 'next/link';
import { can } from '@/lib/permissions';
import { requirePage } from '@/lib/auth';
import { assetCats } from '@/lib/assets';
import { AssetCatForm } from '@/components/AssetCatForm';
import { getDb } from '@/lib/db';

export default async function Cats() {
  const user = await requirePage('expenses.read');
  const W = can(user.role, 'expenses.write');
  const cats = await assetCats();
  const accts = await (await getDb()).q<{ code: string; name: string }>(`select code, name from accounts where not is_control and is_active and (code ~ '^1[0-9]{4}$' or code ~ '^5[0-9]{4}$') order by code`);
  const assets = accts.filter(a => a.code.startsWith('1')), expenses = accts.filter(a => a.code.startsWith('5'));
  const cnt = new Map((await (await getDb()).q<any>(`select category_id, count(*)::int n from fixed_assets where status <> 'void' group by 1`)).map(r => [r.category_id, r.n]));
  return (<>
    <div className="top"><div><h1>หมวดหมู่สินทรัพย์</h1><p className="sub">กำหนดบัญชีสินทรัพย์ ค่าเสื่อมราคา และค่าเสื่อมราคาสะสมของแต่ละหมวด · อายุใช้งานตั้งต้นของหมวดที่ไม่ใช่ไอที เป็นค่าสมมติที่ต้องให้เจ้าของระบบยืนยัน</p></div>
      <div className="acts"><Link className="btn sm ghost" href="/assets">รายการสินทรัพย์</Link>{W && <AssetCatForm label="+ สร้างหมวดหมู่" assets={assets} expenses={expenses} />}</div></div>
    <section className="panel" style={{ overflowX: 'auto' }}><table><thead><tr><th>ชื่อหมวด</th><th className="num">อายุ (ปี)</th><th className="num">อัตรา/ปี</th><th>บัญชีสินทรัพย์</th><th>บัญชีค่าเสื่อมราคา</th><th>บัญชีค่าเสื่อมราคาสะสม</th><th className="num">สินทรัพย์</th><th /></tr></thead>
      <tbody>{cats.map(c => <tr key={c.id}><td>{c.name}<small className="sub"> {c.name_en}</small></td><td className="num">{c.life_years ? Number(c.life_years) : '-'}</td>
        <td className="num">{c.life_years ? (Math.round(10000 / Number(c.life_years)) / 100).toFixed(2) + '%' : '-'}</td><td className="no">{c.asset_account}</td><td className="no">{c.dep_account ?? '-'}</td><td className="no">{c.accum_account ?? '-'}</td>
        <td className="num">{cnt.get(c.id) ?? 0}</td><td>{W && <AssetCatForm label="แก้ไข" assets={assets} expenses={expenses} cat={{ id: c.id, name: c.name, name_en: c.name_en ?? '', depreciate: c.depreciate, life_years: c.life_years ? String(Number(c.life_years)) : '', asset_account: c.asset_account, dep_account: c.dep_account ?? '', accum_account: c.accum_account ?? '' }} />}</td></tr>)}</tbody></table></section>
  </>);
}
