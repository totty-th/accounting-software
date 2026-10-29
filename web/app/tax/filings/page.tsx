import Link from 'next/link';
import { requirePage } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { getDb, today } from '@/lib/db';
import { money } from '@/lib/format';
import { ActionButton } from '@/components/ActionButton';
import { Pp30Create, Pp30Pay, Pp36Create } from '@/components/Pp30Forms';
import { deletePp30, resetPp30Payment, setPp30Refund, deletePp36, resetPp36Payment } from '@/lib/actions';

export const dynamic = 'force-dynamic';
export default async function Filings({ searchParams }: { searchParams: { form?: string; month?: string } }) {
  const user = await requirePage('reports.read');
  const db = await getDb();
  const rows = await db.q<any>(`select id, to_char(period_month,'MM-YYYY') m, period_month::text pm, seq, output_vat::float8 o, input_vat::float8 i, result, amount::float8 amt,
      paid_date::text paid, pv_voucher_id, refund_recorded from pp30_filings where status='filed' order by period_month desc, seq desc`);
  const banks = await db.q<any>(`select code, name from accounts where type='asset' and code like '111%' and is_active order by code`);
  const canW = can(user.role, 'accounts.write');
  const prev = new Date(today() + 'T00:00:00Z'); prev.setUTCMonth(prev.getUTCMonth() - 1);
  const status = (r: any) => r.result === 'payable' ? (r.paid ? `ชำระภาษีแล้ว ${r.paid}` : 'รอชำระภาษี') : r.result === 'refund' ? (r.refund_recorded ? 'บันทึกขอคืนแล้ว' : 'รอขอคืน') : 'ไม่มียอดชำระ';
  const is36 = searchParams.form === '36';
  const month30 = /^\d{4}-\d{2}$/.test(searchParams.month ?? '') ? searchParams.month! : prev.toISOString().slice(0, 7);
  if (is36) {
    const month = /^\d{4}-\d{2}$/.test(searchParams.month ?? '') ? searchParams.month! : prev.toISOString().slice(0, 7);
    const f36 = await db.q<any>(`select id, to_char(period_month,'MM-YYYY') m, base_amount::float8 b, vat_amount::float8 v, paid_date::text paid from pp36_filings where status='filed' order by period_month desc, created_at desc`);
    const cand = (await db.q<any>(`select t.doc_type type, t.doc_id id, t.invoice_date::text date, t.invoice_no inv, t.vendor_name vendor, t.base_amount::float8 base, t.vat_amount::float8 vat
        from purchase_tax_invoices t where t.vat_form='PP36' and to_char(t.invoice_date,'YYYY-MM')=$1
         and not exists (select 1 from pp36_filing_docs f where f.doc_type=t.doc_type and f.doc_id=t.doc_id)
         and not exists (select 1 from expenses e where t.doc_type='EXP' and e.id=t.doc_id and e.status in ('rejected','cancelled'))
         and not exists (select 1 from goods_receipts g where t.doc_type='RI' and g.id=t.doc_id and g.status in ('rejected','cancelled'))
         order by t.invoice_date, t.invoice_no`, [month]));
    return (
      <>
        <div className="top"><div><h1>เตรียมแบบภาษีรายเดือน</h1><p className="sub">แบบ ภ.พ.36 (ซื้อสินค้า/บริการจากต่างประเทศ) · ฐานภาษี = มูลค่าที่จ่ายจริง VAT 7% · ลงบัญชีวันสิ้นเดือน (ตัด VAT เดิมเป็นต้นทุน + บันทึกเจ้าหนี้สรรพากร)</p></div></div>
        <div className="tabs noprint"><Link href="/tax/filings">ภ.พ.30</Link><Link href="/tax/filings?form=36" className="on">ภ.พ.36</Link></div>
        {canW && <>
          <form className="row-inline" method="get"><input type="hidden" name="form" value="36" /><label className="f">เดือนที่ยื่นแบบ<input type="month" name="month" defaultValue={month} /></label><button className="btn">ดูใบกำกับ</button></form>
          <Pp36Create month={month} docs={cand} /></>}
        <div className="panel" style={{ padding: 0, overflowX: 'auto' }}>
          <table><thead><tr><th>เดือนที่ยื่นแบบ</th><th>แบบ</th><th className="num">ยอดซื้อต่างประเทศ</th><th className="num">ภาษีที่ต้องชำระ</th><th>สถานะ</th><th /></tr></thead>
            <tbody>{f36.map(r => <tr key={r.id}><td>{r.m}</td><td>ภ.พ.36</td><td className="num">{money(r.b)}</td><td className="num">{money(r.v)}</td><td>{r.paid ? `ชำระภาษีแล้ว ${r.paid}` : 'รอชำระภาษี'}</td>
              <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{canW && <>
                {!r.paid && r.v > 0 && <Pp30Pay kind="36" id={r.id} accounts={banks} defaultDate={today()} />}
                {r.paid && <ActionButton action={resetPp36Payment.bind(null, r.id)} label="รีเซ็ตการชำระ" variant="ghost" confirmText="รีเซ็ตการบันทึกชำระ?" />}
                {!r.paid && <ActionButton action={deletePp36.bind(null, r.id)} label="ลบแบบ" variant="danger" confirmText="ลบแบบ? รายการบัญชีของแบบจะถูกกลับรายการ (-R)" />}</>}</td></tr>)}
              {f36.length === 0 && <tr><td colSpan={6} className="empty">ยังไม่มีแบบ ภ.พ.36</td></tr>}</tbody></table>
        </div>
      </>
    );
  }
  const cand30 = (await db.q<any>(`select t.doc_type type, t.doc_id id, t.invoice_date::text date, t.invoice_no inv, t.vendor_name vendor, t.vat_form form,
        case when t.vat_form='PP36' then f.vat_amount else t.vat_amount end::float8 vat, f.rd_receipt_no rd
      from purchase_tax_invoices t left join pp36_filing_docs f on f.doc_type=t.doc_type and f.doc_id=t.doc_id
     where to_char(t.invoice_date,'YYYY-MM')=$1
       and (t.vat_form='PP30' or (f.rd_receipt_no is not null and exists (select 1 from pp36_filings p where p.id=f.filing_id and p.status='filed' and p.pv_voucher_id is not null)))
       and not exists (select 1 from pp30_filing_docs x where x.doc_type=t.doc_type and x.doc_id=t.doc_id)
       and not exists (select 1 from expenses e where t.doc_type='EXP' and e.id=t.doc_id and e.status in ('rejected','cancelled'))
       and not exists (select 1 from goods_receipts g where t.doc_type='RI' and g.id=t.doc_id and g.status in ('rejected','cancelled'))
     order by t.invoice_date, t.invoice_no`, [month30]));
  const out30 = (await db.q<any>(`select (coalesce((select sum(l.credit-l.debit) from journal_lines l join journal_vouchers v on v.id=l.voucher_id join accounts a on a.id=l.account_id
      where a.code='27111' and to_char(v.voucher_date,'YYYY-MM')=$1 and v.source_type is distinct from 'PP30'),0)
      - coalesce((select sum(output_vat) from pp30_filings where status='filed' and to_char(period_month,'YYYY-MM')=$1),0))::float8 o`, [month30]))[0].o;
  return (
    <>
      <div className="top"><div><h1>เตรียมแบบภาษีรายเดือน</h1><p className="sub">แบบ ภ.พ.30 รายเดือน · ย้ายภาษีซื้อและหักกลบภาษีขาย ลงบัญชีวันสิ้นเดือน · ดูรายละเอียดที่ <Link href="/reports/sales-tax">ภาษีขาย</Link> / <Link href="/reports/purchase-tax">ภาษีซื้อ</Link></p></div></div>
      <div className="tabs noprint"><Link href="/tax/filings" className="on">ภ.พ.30</Link><Link href="/tax/filings?form=36">ภ.พ.36</Link></div>
      {canW && <>
        <form className="row-inline" method="get"><label className="f">เดือนที่ยื่นแบบ<input type="month" name="month" defaultValue={month30} /></label><button className="btn">ดูใบกำกับ</button></form>
        <Pp30Create key={month30} month={month30} docs={cand30} outputVat={out30} /></>}
      <div className="panel" style={{ padding: 0, overflowX: 'auto' }}>
        <table><thead><tr><th>เดือนที่ยื่นแบบ</th><th>แบบ</th><th className="num">ภาษีขาย</th><th className="num">ภาษีซื้อ</th><th className="num">ภาษีที่ต้องชำระ / ขอคืน</th><th>สถานะ</th><th /></tr></thead>
          <tbody>{rows.map(r => <tr key={r.id}><td>{r.m}{r.seq > 0 ? ` (ยื่นเพิ่มเติม-${r.seq})` : ' (ยื่นปกติ)'}</td><td>ภ.พ.30</td><td className="num">{money(r.o)}</td><td className="num">{money(r.i)}</td>
            <td className="num">{r.result === 'refund' ? `ขอคืน ${money(r.amt)}` : money(r.result === 'payable' ? r.amt : 0)}</td><td>{status(r)}</td>
            <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{canW && <>
              {r.result === 'payable' && !r.paid && <Pp30Pay id={r.id} accounts={banks} defaultDate={today()} />}
              {r.paid && <ActionButton action={resetPp30Payment.bind(null, r.id)} label="รีเซ็ตการชำระ" variant="ghost" confirmText="รีเซ็ตการบันทึกชำระ?" />}
              {r.result === 'refund' && <ActionButton action={setPp30Refund.bind(null, r.id, !r.refund_recorded)} label={r.refund_recorded ? 'รีเซ็ตขอคืน' : 'บันทึกขอคืน'} variant="ghost" />}
              {!r.paid && <ActionButton action={deletePp30.bind(null, r.id)} label="ลบแบบ" variant="danger" confirmText="ลบแบบ? รายการบัญชีของแบบจะถูกกลับรายการ (-R)" />}</>}</td></tr>)}
            {rows.length === 0 && <tr><td colSpan={7} className="empty">ยังไม่มีแบบ ภ.พ.30</td></tr>}</tbody></table>
      </div>
    </>
  );
}
