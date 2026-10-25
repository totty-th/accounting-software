import { can } from '@/lib/permissions';
import { requirePage } from '@/lib/auth';
import { today } from '@/lib/db';
import { getDb } from '@/lib/db';
import { poFormData } from '@/lib/po-data';
import { dateIso } from '@/lib/format';
import { ExpForm } from '@/components/ExpForm';

export default async function NewExpense({ searchParams }: { searchParams: { po?: string } }) {
  const user = await requirePage('expenses.write');
  const { vendors } = await poFormData();
  const db = await getDb();
  const accounts = (await db.q(`select code, name from accounts where type in ('expense','asset') and code not in ('11112','11311','11319','17111','17113','17114','17120') order by code`))
    .map(a => ({ id: a.code as string, label: `${a.code} ${a.name}` }));
  // สร้างจากใบสั่งซื้อ (แบบ FA): เติมผู้จำหน่าย/รายการ/เลขอ้างอิงจาก PO · ต้องเลือกหมวดเอง · ยังไม่บันทึก = PO ไม่เปลี่ยน
  let fromPo: any;
  if (searchParams.po && /^[0-9a-f-]{36}$/.test(searchParams.po)) {
    const po = (await db.q<any>(`select * from purchase_orders where id=$1 and status in ('pending','approved')`, [searchParams.po]))[0];
    if (po) {
      const ls = await db.q<any>(`select l.*, p.name pname from purchase_order_lines l join products p on p.id=l.product_id where l.po_id=$1 order by l.line_no`, [po.id]);
      fromPo = { id: po.id, no: po.po_no,
        header: { contact: po.contact_id, credit_days: String(po.credit_days ?? 0), due_date: po.due_date ? dateIso(po.due_date) : undefined, purchaser: po.purchaser ?? undefined,
          project: po.project ?? '', ref_no: po.po_no, description: po.description ?? '', price_mode: po.price_mode, note: po.note ?? '' },
        lines: ls.map(l => ({ description: l.description || l.pname, account: '', unit: l.unit ?? '', qty: String(Number(l.qty)), unit_price: String(Number(l.unit_price)),
          dtype: l.discount_type, dval: Number(l.discount_value) ? String(Number(l.discount_value)) : '', vat: l.vat_exempt ? 'exempt' : String(Number(l.vat_rate)), wht: String(Number(l.wht_rate)) })) };
    }
  }
  return (<>
    <div className="top"><div><h1>สร้างค่าใช้จ่าย{fromPo ? ` จากใบสั่งซื้อ ${fromPo.no}` : ''}</h1><p className="sub">บันทึกแล้วตั้งเจ้าหนี้ทันที · จ่ายเงินที่หน้าเอกสาร</p></div></div>
    <ExpForm vendors={vendors} accounts={accounts} today={today()} purchaser={user.displayName || user.username} canCreateVendor={can(user.role, 'contact.create')} fromPo={fromPo} />
  </>);
}
