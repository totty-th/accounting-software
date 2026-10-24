import { getDb, today } from '@/lib/db';
import { SalesDocForm } from '@/components/DocForm';
import { QtForm } from '@/components/QtForm';
import { qtFormData } from '@/lib/qt-data';
import { DOC_TYPE } from '@/lib/status';
import { createSalesDoc } from '@/lib/actions';
import { partyName } from '@/lib/format';
import { requirePage } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { redirect } from 'next/navigation';

export default async function NewDoc({ searchParams }: { searchParams: { type?: string } }) {
  const user = await requirePage(['sales.write', 'quote.own']);
  const ownOnly = !can(user.role, 'sales.write');                // ฝ่ายขายสร้างได้เฉพาะใบเสนอราคา
  const type = ownOnly ? 'QT' : ['QT', 'INV', 'CA'].includes(searchParams.type ?? '') ? searchParams.type! : 'INV';
  if (ownOnly && searchParams.type && searchParams.type !== 'QT') redirect('/sales/new?type=QT');
  if (type === 'QT' || type === 'INV') {
    const d = await qtFormData();
    return (<>
      <div className="top"><div>{type === 'QT'
        ? <><h1>สร้างใบเสนอราคา</h1><p className="sub">ไม่ลงบัญชีและไม่ขยับสต็อก · อนุมัติแล้วจึงสร้างใบแจ้งหนี้ได้</p></>
        : <><h1>สร้างใบแจ้งหนี้</h1><p className="sub">ลงลูกหนี้/รายได้/ภาษีขายทันที · ตัดสต็อกสินค้านับสต็อก · หัก ณ ที่จ่ายไปลงตอนรับชำระ</p></>}</div></div>
      <QtForm docType={type} id={null} {...d} today={today()} salesperson={user.displayName || user.username} canCreateCustomer={can(user.role, 'contact.create')} canCreateProduct={can(user.role, 'master.write') || can(user.role, 'quote.own')} />
    </>);
  }
  const db = await getDb();
  const customers = (await db.q(`select id, business_name, contact_name from contacts where not is_cash_default and is_customer order by business_name nulls last`))
    .map(c => ({ id: c.id as string, label: partyName(c) }));
  const products = (await db.q(`select id, code, name, sale_price, kind from products where is_active order by code`))
    .map(p => ({ id: p.id as string, label: `${p.code} ${p.name}`, price: Number(p.sale_price), kind: p.kind as string }));
  return (
    <>
      <div className="top"><h1>{DOC_TYPE[type]}ใหม่</h1></div>
      <SalesDocForm type={type} title={DOC_TYPE[type]} customers={customers} products={products} today={today()} action={createSalesDoc} />
    </>
  );
}
