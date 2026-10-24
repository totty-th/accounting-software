import { requirePage } from '@/lib/auth';
import { getDb, today, monthStart } from '@/lib/db';
import { money, dateTh } from '@/lib/format';
import { Group } from '@/components/Board';

export default async function PurchaseTax({ searchParams }: { searchParams: { from?: string; to?: string } }) {
  await requirePage('reports.read');
  const from = searchParams.from || monthStart(), to = searchParams.to || today();
  const rows = await (await getDb()).q(`select * from purchase_tax_invoice_report($1::date,$2::date)`, [from, to]);
  const sum = (f: string) => rows.filter(r => r.vat_form === f).reduce((a, r) => ({ b: a.b + Number(r.base_amount), v: a.v + Number(r.vat_amount) }), { b: 0, v: 0 });
  return (
    <>
      <div className="top"><div><h1>รายงานใบกำกับภาษีซื้อที่ได้รับ</h1>
        <p className="sub">จากข้อมูลใบกำกับภาษีที่บันทึกในค่าใช้จ่ายและใบรับสินค้า · ไม่รวมเอกสารที่ไม่อนุมัติ/ยกเลิก · ภ.พ.36 แสดงแยก (ยังไม่ลงบัญชีภาษีของ ภ.พ.36)</p></div></div>
      <form className="row-inline" method="get">
        <label className="f">ตั้งแต่<input type="date" name="from" defaultValue={from} /></label>
        <label className="f">ถึง<input type="date" name="to" defaultValue={to} /></label>
        <button className="btn">ดูรายงาน</button>
      </form>
      <Group title="รายการ" color="var(--blue)" count={rows.length}>
        {rows.length === 0 ? <div className="empty">ไม่มีใบกำกับภาษีในช่วงนี้</div> :
          <table><thead><tr><th>วันที่</th><th>เลขที่ใบกำกับ</th><th>ผู้จำหน่าย</th><th>เลขผู้เสียภาษี</th><th>สาขา</th><th>แบบ</th><th>เอกสาร</th><th className="num">มูลค่า</th><th className="num">VAT</th></tr></thead>
            <tbody>{rows.map(r => (
              <tr key={`${r.doc_type}${r.doc_no}`}><td>{dateTh(r.invoice_date)}</td><td className="no">{r.invoice_no}</td><td>{r.vendor_name}</td><td>{r.vendor_tax_id ?? '-'}</td>
                <td>{r.branch ?? '-'}</td><td>{r.vat_form === 'PP36' ? 'ภ.พ.36' : 'ภ.พ.30'}</td><td className="no">{r.doc_no}</td>
                <td className="num">{money(r.base_amount)}</td><td className="num">{money(r.vat_amount)}</td></tr>))}
              {(['PP30', 'PP36'] as const).map(f => <tr key={f} style={{ fontWeight: 700 }}><td colSpan={7}>รวม {f === 'PP30' ? 'ภ.พ.30' : 'ภ.พ.36'}</td>
                <td className="num">{money(sum(f).b)}</td><td className="num">{money(sum(f).v)}</td></tr>)}</tbody></table>}
      </Group>
    </>
  );
}
