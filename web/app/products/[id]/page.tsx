import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePage } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { getDb, today } from '@/lib/db';
import { money, qty, dateTh } from '@/lib/format';
import { KIND_LABEL } from '@/lib/stock-labels';
import { StockAdjustDialog } from '@/components/StockAdjustDialog';
import { ActionButton } from '@/components/ActionButton';
import { deleteAdjustment, deleteProduct, setProductActive } from '@/lib/actions';

export const dynamic = 'force-dynamic';
const DOC_HREF = (t: string, no: string, id: string): string | null =>
  t === 'TF' ? `/stock/transfers/${id}` : t === 'RI' ? `/purchases/ri/${id}` : ['INV', 'CA', 'CN', 'DN'].includes(t) ? `/sales/${no}` : null;

export default async function ProductPage({ params, searchParams }: { params: { id: string }; searchParams: { tab?: string; wh?: string } }) {
  const user = await requirePage('master.read');
  const db = await getDb();
  const [p] = await db.q<any>('select * from products where id::text = $1', [params.id]);
  if (!p) notFound();
  const stockTab = searchParams.tab === 'stock' && p.kind === 'goods_stock';
  const writable = can(user.role, 'master.write');
  const units = await db.q<any>('select * from product_units where product_id=$1 order by factor', [p.id]);
  const out: any = { p, units };
  if (stockTab) {
    const whs = await db.q<any>(`select w.id, w.name, w.is_main, coalesce(sum(m.qty_in-m.qty_out),0)::float8 qty from warehouses w
      left join stock_movements m on m.warehouse_id=w.id and m.product_id=$1 and m.voided_at is null group by w.id order by w.is_main desc, w.code`, [p.id]);
    const wh = whs.some(w => w.id === searchParams.wh) ? searchParams.wh! : '';
    const [st] = await db.q<any>('select qty::float8 q, value::float8 v from product_stock where product_id=$1', [p.id]);
    const avg = await db.q<any>('select product_avg_cost($1)::float8 a', [p.id]);
    const [sell] = await db.q<any>(`select case when sum(l.qty)>0 then round(sum(l.amount)/sum(l.qty),2) else 0 end a from sales_doc_lines l join sales_docs d on d.id=l.doc_id
      where l.product_id=$1 and d.doc_type in ('INV','CA') and d.status<>'cancelled' and not d.is_deposit`, [p.id]);
    const mv = await db.q<any>(`select m.*, w.name wh_name, a.id adj_id, a.reason adj_reason, a.status adj_status,
        (select coalesce(c.business_name,c.contact_name) from sales_docs d join contacts c on c.id=d.contact_id where d.id=m.doc_id) cp_s,
        (select coalesce(c.business_name,c.contact_name) from goods_receipts g join contacts c on c.id=g.contact_id where g.id=m.doc_id) cp_p,
        (select id from sales_docs where id=m.doc_id) sid
      from stock_movements m join warehouses w on w.id=m.warehouse_id left join stock_adjustments a on a.id=m.doc_id
      where m.product_id=$1 and m.voided_at is null and ($2='' or m.warehouse_id=$2::uuid) order by m.move_date desc, m.seq desc`, [p.id, wh]);
    // คงเหลือสะสมหลังแต่ละรายการ (คำนวณจากเก่าไปใหม่ ในขอบเขตคลังที่กรอง)
    let run = 0; const bal = new Map<string, number>(); [...mv].reverse().forEach(m => { run += Number(m.qty_in) - Number(m.qty_out); bal.set(m.id, run); });
    Object.assign(out, { whs, wh, st, avg: avg[0].a, sell: sell?.a ?? 0, mv, bal });
  }
  const { whs, wh, st, avg, sell, mv, bal } = out;
  const tabHref = (t: string) => `/products/${p.id}${t ? `?tab=${t}` : ''}`;
  return (
    <>
      <div className="top"><div><p className="sub"><Link href="/products">← ย้อนกลับ: รายการสินค้าทั้งหมด</Link></p><h1>{p.code} {p.name}{!p.is_active && <span className="pill grey" style={{ marginLeft: 8, display: 'inline-block' }}>ปิดใช้งาน</span>}</h1></div>
        {!stockTab && writable && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Link className="btn sm" href={`/products/${p.id}/edit`}>แก้ไขสินค้า</Link>
          <Link className="btn sm ghost" href={`/products/new?from=${p.id}`}>สร้างซ้ำ</Link>
          <ActionButton variant="ghost" label={p.is_active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'} action={setProductActive.bind(null, p.id, !p.is_active)} />
          <ActionButton variant="danger" label="ลบสินค้า" confirmText="ลบสินค้านี้ถาวร (ลบไม่ได้ถ้าเคยถูกใช้งานแล้ว)" action={deleteProduct.bind(null, p.id)} after="/products" /></div>}
        {stockTab && writable && <StockAdjustDialog product={p.id} unit={p.base_unit} today={today()} whs={whs.map((w: any) => ({ id: w.id, name: w.name, qty: w.qty }))} onhand={Number(st?.q ?? 0)} />}</div>
      <div className="tabs noprint"><Link href={tabHref('')} className={!stockTab ? 'on' : ''}>รายละเอียดขาย-ซื้อ</Link>
        {p.kind === 'goods_stock' && <Link href={tabHref('stock')} className={stockTab ? 'on' : ''}>ข้อมูลสต็อกสินค้า</Link>}</div>
      {!stockTab ? <>
        <div className="panel"><h3>ข้อมูลสินค้า</h3>
          <ul className="rel"><li>ประเภทสินค้า: {KIND_LABEL[p.kind]}</li><li>ชื่อสินค้า: {p.name}</li><li>รหัสสินค้า: {p.code}</li><li>หน่วยสินค้าหลัก: {p.base_unit}</li>
            <li>หมวดสินค้า: {p.category ?? '-'}</li><li>เลขบาร์โค้ด: {p.barcode ?? '-'}</li>{p.kind === 'goods_stock' && <li>ห้ามติดลบ: {p.block_negative ? 'ใช่ (กันขาย/โอน/ปรับลดเกินคงเหลือ)' : 'ไม่'}</li>}</ul></div>
        <div className="panel" style={{ display: 'flex', gap: 40, flexWrap: 'wrap' }}>
          <div><h3>ข้อมูลการขาย</h3><p>ราคาขาย: <b>{money(p.sale_price)}</b> บาท</p></div>
          {can(user.role, 'cost.view') && <div><h3>ข้อมูลการซื้อ</h3><p>ราคาซื้อ: <b>{money(p.purchase_price)}</b> บาท</p></div>}</div>
        {units.length > 0 && <div className="panel" style={{ padding: 0, overflowX: 'auto' }}><h3 style={{ padding: '12px 14px 0' }}>หน่วยสินค้า (หน่วยหลัก: {p.base_unit})</h3>
          <table><thead><tr><th>หน่วยสินค้าอื่น</th><th className="num">= {p.base_unit}</th><th className="num">ราคาขาย</th><th className="num">ราคาซื้อ</th></tr></thead>
            <tbody>{units.map((u: any) => <tr key={u.unit}><td>{u.unit}</td><td className="num">{qty(u.factor)}</td><td className="num">{money(u.sale_price)}</td><td className="num">{money(u.purchase_price)}</td></tr>)}</tbody></table></div>}
      </> : <>
        <div className="panel" style={{ display: 'flex', gap: 28, flexWrap: 'wrap' }}>
          <div><div className="sub">จำนวนคงเหลือทั้งหมด</div><strong>{qty(st?.q ?? 0)} {p.base_unit}</strong>{units.length > 0 && <div className="sub">{units.map((u: any) => `≈ ${qty(Number(st?.q ?? 0) / Number(u.factor))} ${u.unit}`).join(' · ')}</div>}</div>
          <div><div className="sub">ราคาขายเฉลี่ย</div><strong>{money(sell)}</strong> บาท</div>
          <div><div className="sub">ราคาซื้อเฉลี่ย (ต้นทุนเฉลี่ยเคลื่อนที่)</div><strong>{money(avg)}</strong> บาท</div>
          <div><div className="sub">มูลค่าสินค้าคงเหลือเฉลี่ย</div><strong>{money(st?.v ?? 0)}</strong> บาท</div></div>
        <div className="panel" style={{ padding: 0 }}><h3 style={{ padding: '12px 14px 0' }}>คลังสินค้า</h3>
          <table><thead><tr><th>ชื่อคลังสินค้า</th><th className="num">จำนวนคงเหลือ</th></tr></thead>
            <tbody>{whs.map((w: any) => <tr key={w.id}><td>{w.name}{w.is_main && <span className="sub"> (คลังหลัก)</span>}</td><td className="num" style={{ color: w.qty < 0 ? 'var(--red)' : undefined }}>{qty(w.qty)}</td></tr>)}</tbody></table></div>
        <form className="noprint" style={{ margin: '10px 0' }} action={`/products/${p.id}`}><input type="hidden" name="tab" value="stock" />
          <label>คลังสินค้า: <select name="wh" defaultValue={wh}><option value="">คลังทั้งหมด</option>{whs.map((w: any) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>{' '}<button className="btn sm ghost">กรอง</button></form>
        <div className="panel" style={{ padding: 0, overflowX: 'auto' }}><h3 style={{ padding: '12px 14px 0' }}>ความเคลื่อนไหวสินค้า</h3>
          {mv.length === 0 ? <div className="empty">ยังไม่มีความเคลื่อนไหว</div> :
            <table><thead><tr><th></th><th>วันที่</th><th>เลขที่เอกสาร</th><th>ชื่อผู้ติดต่อ / รายละเอียด</th><th className="num">ราคาต่อหน่วย</th><th>คลังสินค้า</th><th className="num">จำนวนเข้า</th><th className="num">จำนวนออก</th><th>หน่วย</th><th className="num">คงเหลือ ({p.base_unit})</th></tr></thead>
              <tbody>{mv.map((m: any) => {
                const isIn = Number(m.qty_in) > 0; const href = m.doc_type === 'ADJ' ? null : DOC_HREF(m.doc_type, m.doc_no, m.sid ?? m.doc_id);
                return <tr key={m.id}><td><span className="pill" style={{ background: isIn ? 'var(--green)' : 'var(--red)', color: '#fff' }}>{isIn ? 'เข้า' : 'ออก'}</span></td>
                  <td>{dateTh(m.move_date)}</td><td className="no">{href ? <Link href={href}>{m.doc_no}</Link> : m.doc_no}{m.adj_id && writable && <> <ActionButton variant="ghost" label="ลบรายการ" confirmText="ลบรายการปรับยอดนี้ และคืนสต็อกกลับ" action={deleteAdjustment.bind(null, m.adj_id)} /></>}</td>
                  <td>{m.cp_s ?? m.cp_p ?? (m.doc_type === 'ADJ' ? `ปรับ${isIn ? 'เพิ่ม' : 'ลด'} - ${m.adj_reason}` : m.doc_type === 'TF' ? 'โอนสินค้า - โอนระหว่างคลัง' : '')}</td>
                  <td className="num">{money(m.unit_cost)}</td><td>{m.wh_name}</td><td className="num">{isIn ? qty(m.qty_in) : ''}</td><td className="num">{isIn ? '' : qty(m.qty_out)}</td><td>{p.base_unit}</td>
                  <td className="num" style={{ color: (bal.get(m.id) ?? 0) < 0 ? 'var(--red)' : undefined }}>{qty(bal.get(m.id))}</td></tr>; })}</tbody></table>}</div>
      </>}
    </>
  );
}
