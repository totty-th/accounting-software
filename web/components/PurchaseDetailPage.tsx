import { ActsMenu } from '@/components/ActsMenu';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDb } from '@/lib/db';
import { requirePage } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { dateTh, money, partyName } from '@/lib/format';
import { loadPurchaseView, type PKind } from '@/lib/purchase-pdf';
import { Pill } from '@/components/Pill';
import { ActionButton } from '@/components/ActionButton';
import { PurchaseDocTools } from '@/components/PurchaseDocTools';
import { TaxInvoiceBox } from '@/components/TaxInvoiceBox';
import { PayForm } from '@/components/PayForm';
import * as A from '@/lib/actions';

const BACK: Record<string, [string, string]> = { EXP: ['/expenses', 'ค่าใช้จ่าย'], RI: ['/purchases', 'ใบรับสินค้า'], PO: ['/purchases/orders', 'ใบสั่งซื้อ'] };
const METHOD: Record<string, string> = { cash: 'เงินสด', transfer: 'โอนเงิน', card: 'บัตรเครดิต' };

/** หน้าเอกสารซื้อ (ค่าใช้จ่าย / ใบรับสินค้า / ใบสั่งซื้อ): ตัวเอกสาร + แถบทำรายการ + ข้อมูลที่เกี่ยวข้อง */
export async function PurchaseDetailPage({ kind, id }: { kind: 'EXP' | 'RI' | 'PO'; id: string }) {
  const user = await requirePage('expenses.read');
  const W = can(user.role, 'expenses.write'), AP = can(user.role, 'expenses.approve'), MW = can(user.role, 'master.write');
  const v = await loadPurchaseView(kind as PKind, id);
  if (!v) notFound();
  const db = await getDb();
  const tbl = kind === 'EXP' ? 'expenses' : kind === 'RI' ? 'goods_receipts' : 'purchase_orders';
  const h = (await db.q<any>(`select t.*, c.business_name, c.contact_name, c.tax_id from ${tbl} t join contacts c on c.id=t.contact_id where t.id=$1`, [id]))[0];
  const st = h.status as string;
  const pillKey = kind === 'PO' && st === 'pending' ? 'pending_approval' : st;
  const taxInv = kind !== 'PO' ? (await db.q<any>(`select * from purchase_tax_invoices where doc_type=$1 and doc_id=$2`, [kind, id]))[0] : undefined;
  const pays = kind !== 'PO' ? await db.q<any>(`select p.*, b.bank_name, b.account_no, cc.card_name, cc.last4 from purchase_payments p
      left join bank_accounts b on b.id=p.bank_account_id left join credit_cards cc on cc.id=p.credit_card_id where p.doc_type=$1 and p.doc_id=$2 order by p.line_no`, [kind, id]) : [];
  const vouchers = await db.q<any>(`select voucher_no from journal_vouchers where id = any($1::uuid[]) order by voucher_no`, [[h.uv_voucher_id, h.pv_voucher_id].filter(Boolean)]);
  const banks = (await db.q(`select id, bank_name, account_no from bank_accounts where is_active order by bank_name`)).map(b => ({ id: b.id as string, label: `${b.bank_name} ${b.account_no}` }));
  const cards = (await db.q(`select id, card_name, last4 from credit_cards where is_active order by card_name`)).map(c => ({ id: c.id as string, label: `${c.card_name} ****${c.last4}` }));
  const petties = (await db.q(`select id, fund_name from petty_funds where is_active order by fund_name`)).map(f => ({ id: f.id as string, label: f.fund_name as string }));
  const po = kind === 'RI' && h.po_id ? (await db.q<any>('select id, po_no from purchase_orders where id=$1', [h.po_id]))[0] : null;
  const ri = kind === 'PO' && h.ri_id ? (await db.q<any>('select id, ri_no from goods_receipts where id=$1', [h.ri_id]))[0] : null;
  const [back, backName] = BACK[kind];
  const payable = kind === 'EXP' ? ['pending', 'approved'] : ['unpaid', 'approved'];
  const net = kind === 'EXP' ? Number(h.total) - Number(h.wht_total) : Number(h.total);
  const A_ = kind === 'EXP' ? { approve: A.approveExpense, reject: A.rejectExpense, reset: A.resetExpense, cancel: A.cancelExpense }
    : kind === 'RI' ? { approve: A.approveGoodsReceipt, reject: A.rejectGoodsReceipt, reset: A.resetGoodsReceipt, cancel: A.cancelGoodsReceipt }
      : { approve: A.approvePurchaseOrder, reject: A.rejectPurchaseOrder, reset: A.resetPurchaseOrder, cancel: A.cancelPurchaseOrder };
  const pendingKey = kind === 'RI' ? 'unpaid' : 'pending';
  const vendor = { name: partyName(h), tax_id: h.tax_id };
  return (
    <>
      <div className="top noprint">
        <div><h1>{v.no} <Pill s={pillKey} /></h1><p className="sub"><Link href={back}>← {backName}</Link></p></div>
        <ActsMenu>
          <a className="btn ghost" href={`/purchases/${kind.toLowerCase()}/${id}/pdf`} target="_blank">ดาวน์โหลด PDF</a>
          {kind === 'PO' && W && st === 'pending' && <Link className="btn ghost" href={`/purchases/orders/${id}/edit`}>แก้ไข</Link>}
          {kind === 'PO' && W && <ActionButton label="สร้างซ้ำ" variant="ghost" action={A.duplicatePurchaseOrder.bind(null, id)} />}
          {AP && st === pendingKey && <ActionButton label="อนุมัติ" action={(A_.approve as any).bind(null, id)} />}
          {kind === 'PO' && W && (st === 'pending' || st === 'approved') && <ActionButton label="สร้างใบรับสินค้า" action={A.upgradePoToRi.bind(null, id)} />}
          {kind !== 'PO' && W && payable.includes(st) && (
            <details><summary className="btn">จ่ายเงิน</summary>
              <PayForm net={net} banks={banks} cards={cards} petties={petties} allowShort={kind === 'RI'}
                onPay={(kind === 'EXP' ? A.payExpense : A.payGoodsReceipt).bind(null, id) as any} /></details>)}
          {AP && (st === pendingKey || st === 'approved') && <ActionButton label="ไม่อนุมัติ" variant="ghost" action={(A_.reject as any).bind(null, id)} />}
          {W && (kind === 'PO' ? ['approved', 'rejected'] : ['approved', 'paid', 'rejected']).includes(st) && <ActionButton label="รีเซ็ต" variant="ghost" action={(A_.reset as any).bind(null, id)} />}
          {W && st !== 'cancelled' && st !== 'converted' && <ActionButton label="ยกเลิก" variant="danger" confirmText="c" action={(A_.cancel as any).bind(null, id)} />}
        </ActsMenu>
      </div>
      <div className="detail">
        <section className="panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
            <div><div className="sub">{kind === 'PO' ? 'ผู้จำหน่าย' : 'ผู้จำหน่าย'}</div><h3 style={{ margin: '2px 0' }}>{v.party?.name}</h3>
              <div style={{ whiteSpace: 'pre-line' }}>{v.party?.address}</div>{v.party?.tax_id && <div className="sub">เลขประจำตัวผู้เสียภาษี {v.party.tax_id}</div>}</div>
            <table style={{ minWidth: 0, width: 'auto' }}><tbody>
              <tr><td className="sub">{v.title}เลขที่</td><td>{v.no}</td></tr><tr><td className="sub">วันที่</td><td>{dateTh(v.date)}</td></tr>
              {h.due_date && <tr><td className="sub">ครบกำหนด</td><td>{dateTh(h.due_date)}</td></tr>}
              {v.meta.filter(m => m[0] !== 'ครบกำหนด').map(([k, x]) => <tr key={k}><td className="sub">{k}</td><td>{x}</td></tr>)}
            </tbody></table>
          </div>
          <div style={{ overflowX: 'auto', marginTop: 14 }}>
            <table><thead><tr>{v.cols.map((c, i) => <th key={i} className={c.right ? 'num' : ''}>{c.h}</th>)}</tr></thead>
              <tbody>{v.rows.map((r, i) => <tr key={i}>{r.map((x, j) => <td key={j} className={v.cols[j].right ? 'num' : ''} style={{ whiteSpace: 'pre-line' }}>{x}</td>)}</tr>)}</tbody></table>
          </div>
          <div className="totals" style={{ maxWidth: 360 }}>
            {v.totals.map(([k, x, strong], i) => <div key={i} className={strong ? 't' : ''}><span>{k}</span><span>{x}</span></div>)}
          </div>
          {v.note && <p style={{ whiteSpace: 'pre-line' }}><span className="sub">หมายเหตุ</span><br />{v.note}</p>}
          {kind === 'PO' && h.internal_note && <p style={{ whiteSpace: 'pre-line' }}><span className="sub">โน้ตภายในบริษัท</span><br />{h.internal_note}</p>}
        </section>
        <aside className="side-panels noprint">
          {kind !== 'EXP' && <section className="panel"><h3>ลิงก์แชร์</h3>
            <PurchaseDocTools kind={kind} id={id} token={h.share_token ?? null} canWrite={W} /></section>}
          {kind !== 'PO' && st !== 'rejected' && st !== 'cancelled' && <section className="panel"><h3>ใบกำกับภาษีที่ได้รับ</h3>
            <TaxInvoiceBox type={kind} id={id} inv={taxInv} canWrite={W} vendor={vendor} /></section>}
          {kind !== 'PO' && <section className="panel"><h3>บันทึกการชำระเงิน</h3>
            {pays.length ? <table style={{ minWidth: 0 }}><thead><tr><th>วันที่</th><th>ช่องทาง</th><th className="num">ยอด</th></tr></thead>
              <tbody>{pays.map((p: any) => <tr key={p.line_no}><td>{dateTh(p.pay_date)}</td>
                <td>{METHOD[p.method]}{p.bank_name ? ` ${p.bank_name} ${p.account_no}` : ''}{p.card_name ? ` ${p.card_name} ****${p.last4}` : ''}</td><td className="num">{money(p.amount)}</td></tr>)}</tbody></table>
              : <p className="sub">{st === 'paid' ? 'จ่ายแล้ว (รายละเอียดช่องทางไม่ได้บันทึกไว้)' : 'ยังไม่มีการชำระเงิน'}</p>}</section>}
          <section className="panel"><h3>เอกสารที่เกี่ยวข้อง</h3><ul className="rel">
            {po && <li>มาจากใบสั่งซื้อ <Link href={`/purchases/orders/${po.id}`}>{po.po_no}</Link></li>}
            {ri && <li>สร้างต่อเป็นใบรับสินค้า <Link href={`/purchases/ri/${ri.id}`}>{ri.ri_no}</Link></li>}
            {vouchers.length > 0 && <li>ลงบัญชีที่ใบสำคัญ {vouchers.map((x: any) => x.voucher_no).join(', ')}</li>}
            {!po && !ri && !vouchers.length && <li className="sub">ยังไม่มี</li>}</ul></section>
        </aside>
      </div>
    </>
  );
}
