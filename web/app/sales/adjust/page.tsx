import { requirePage } from '@/lib/auth';
import { notFound } from 'next/navigation';
import { AdjustForm } from '@/components/AdjustForm';
import { loadView } from '@/lib/doc-view';
import { today, getDb } from '@/lib/db';
import { createSalesDoc } from '@/lib/actions';
import { DOC_TYPE } from '@/lib/status';
import Link from 'next/link';
import { Pill } from '@/components/Pill';
import { money, dateTh, partyName } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function Adjust({ searchParams }: { searchParams: { type?: string; ref?: string; contact?: string } }) {
  await requirePage('sales.write');
  const type = searchParams.type === 'DN' ? 'DN' : 'CN';
  if (!searchParams.ref) return <Pick type={type} contact={searchParams.contact} />;
  const v = await loadView(searchParams.ref);
  if (!v || v.doc.doc_type !== 'INV' || v.doc.status === 'cancelled') return notFound();
  const meta = await (await getDb()).q<{ line_no: number; product_id: string | null; is_stock: boolean }>(
    `select l.line_no, l.product_id, coalesce(p.kind = 'goods_stock', false) as is_stock
       from sales_doc_lines l left join products p on p.id = l.product_id where l.doc_id = $1 order by l.line_no`, [v.doc.id]);
  return (
    <>
      <div className="top"><h1>{DOC_TYPE[type]}ใหม่</h1></div>
      <AdjustForm type={type} refId={v.doc.id} contactId={v.contact.id} refNo={v.doc.doc_no} refTotal={+v.doc.total} refSubtotal={+v.doc.subtotal}
        mode={v.doc.price_mode} rate={+v.doc.vat_rate} today={today()} action={createSalesDoc}
        lines={v.lines.map(l => ({ description: l.description, item_kind: l.item_kind, qty: +l.qty, unit_price: +l.unit_price,
          product_id: meta.find(m => m.line_no === l.line_no)?.product_id ?? null,
          is_stock: meta.find(m => m.line_no === l.line_no)?.is_stock ?? false }))} />
    </>
  );
}

// ขั้นที่ 1 (เหมือนต้นแบบ): เลือกลูกค้า → เลือกใบแจ้งหนี้ที่จะอ้างอิง → ขั้นที่ 2 เลือกรายการ/สาเหตุ
async function Pick({ type, contact }: { type: 'CN' | 'DN'; contact?: string }) {
  const db = await getDb();
  const name = DOC_TYPE[type];
  const contacts = await db.q(`select distinct c.id, c.business_name, c.contact_name from contacts c join sales_docs d on d.contact_id=c.id
    where d.doc_type='INV' order by 2, 3`);
  const invs = contact ? await db.q(`select d.doc_no, d.doc_date, d.total, d.status, d.is_deposit, c.business_name, c.contact_name,
      exists(select 1 from sales_docs x where x.ref_doc_id=d.id and x.doc_type='CN') has_cn,
      exists(select 1 from billing_note_items b join sales_docs bl on bl.id=b.billing_id and bl.status<>'cancelled' where b.invoice_id=d.id) in_bl
    from sales_docs d join contacts c on c.id=d.contact_id where d.doc_type='INV' and d.contact_id=$1 order by d.doc_date desc, d.doc_no desc`, [contact]) : [];
  // เหตุที่เลือกไม่ได้ (ตรงกับเงื่อนไขในฟังก์ชันฐานข้อมูล ซึ่งตรวจซ้ำอีกชั้น)
  const why = (r: any) => r.status === 'cancelled' ? 'ใบแจ้งหนี้ถูกยกเลิก' : r.is_deposit ? 'ใบแจ้งหนี้มัดจำ' : r.in_bl ? 'อยู่ในใบวางบิลแล้ว'
    : type === 'DN' && r.status !== 'awaiting_payment' ? 'ต้องเป็นใบแจ้งหนี้ที่รอเก็บเงิน' : type === 'CN' && r.has_cn ? 'มีใบลดหนี้แล้ว (1 ใบแจ้งหนี้ ออกได้ 1 ใบ)' : '';
  return (
    <>
      <div className="top"><div><h1>{name}ใหม่</h1><p className="sub">ขั้นที่ 1 จาก 2: เลือกลูกค้าและใบแจ้งหนี้ที่ต้องการ{type === 'DN' ? 'เพิ่มหนี้' : 'ลดหนี้'}</p></div></div>
      <form className="row-inline" method="get">
        <input type="hidden" name="type" value={type} />
        <label className="f" style={{ minWidth: 320 }}>ลูกค้า
          <select name="contact" defaultValue={contact ?? ''}><option value="">— เลือกลูกค้า —</option>
            {contacts.map((c: any) => <option key={c.id} value={c.id}>{partyName(c)}</option>)}</select></label>
        <button className="btn" type="submit">แสดงใบแจ้งหนี้</button>
      </form>
      {!contact ? <div className="panel empty">กรุณาเลือกลูกค้า เพื่อค้นหาเอกสาร</div> : invs.length === 0 ? <div className="panel empty">ลูกค้ารายนี้ยังไม่มีใบแจ้งหนี้</div> : (
        <div className="panel" style={{ padding: 0, overflowX: 'auto' }}>
          <table><thead><tr><th>วันที่</th><th>เลขที่เอกสาร</th><th>ลูกค้า</th><th className="num">จำนวนเงิน</th><th>สถานะ</th><th /></tr></thead>
            <tbody>{invs.map((r: any) => { const w = why(r); return (
              <tr key={r.doc_no} style={w ? { opacity: .6 } : undefined}>
                <td>{dateTh(r.doc_date)}</td><td className="no">{r.doc_no}</td><td>{partyName(r)}</td><td className="num">{money(r.total)}</td><td><Pill s={r.status} /></td>
                <td>{w ? <span className="sub">{w}</span> : <Link className="btn sm" href={`/sales/adjust?type=${type}&ref=${r.doc_no}`}>เลือก</Link>}</td></tr>); })}</tbody></table>
        </div>)}
    </>
  );
}
