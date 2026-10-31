import { ActsMenu } from '@/components/ActsMenu';
import { can } from '@/lib/permissions';
import { requirePage } from '@/lib/auth';
import Link from 'next/link';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { getDb } from '@/lib/db';
import { Pill } from '@/components/Pill';
import { ReceiptSheet } from '@/components/ReceiptSheet';
import { PrintButton, CopyBox } from '@/components/ShareTools';
import { ActionButton } from '@/components/ActionButton';
import { CollectForm } from '@/components/CollectForm';
import { loadReceiptView, receiptIdByNo } from '@/lib/receipt-view';
import { createReceiptShareLink, revokeReceiptShareLink, resetReceipt, cancelReceipt } from '@/lib/actions';

export const dynamic = 'force-dynamic';

// หน้ารายละเอียดใบเสร็จรับเงิน (เปิดด้วยเลขที่ใบเสร็จ) พิมพ์/ดาวน์โหลด PDF/แชร์ลิงก์ให้ลูกค้า/เก็บเงินหลายช่องทาง
export default async function ReceiptDetail({ params }: { params: { no: string } }) {
  const user = await requirePage('receipts.read');
  const W = can(user.role, 'receipts.write');
  const id = await receiptIdByNo(decodeURIComponent(params.no));
  const v = await loadReceiptView(id);
  if (!id || !v) notFound();
  const db = await getDb();
  const banks = (await db.q<{ id: string; bank_name: string; account_no: string }>(
    `select b.id, b.bank_name, b.account_no from bank_accounts b join accounts a on a.id=b.account_id where b.is_active order by a.code`))
    .map(b => ({ id: b.id, label: `${b.bank_name} ${b.account_no}` }));
  const tok = (await db.q<{ t: string | null }>('select share_token as t from receipts where id=$1', [id]))[0]?.t;
  const h = headers(), host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  const link = tok ? `${proto}://${host}/r/${tok}` : null;
  const no = encodeURIComponent(v.receipt.receipt_no);
  const net = Math.round(Number(v.receipt.amount) * 100 - Number(v.receipt.wht) * 100) / 100;
  return (
    <>
      <div className="top noprint">
        <div><h1>{v.receipt.receipt_no} <Pill s={v.receipt.status} /></h1><p className="sub"><Link href="/receipts">← ใบเสร็จและการรับเงิน</Link></p></div>
        <ActsMenu dropdown><PrintButton />
          <a className="btn ghost" href={`/receipts/${no}/pdf`}>ดาวน์โหลด PDF</a>
          <a className="btn ghost" href={`/receipts/${no}/pdf?both=1`}>PDF ต้นฉบับ+สำเนา</a>
          {W && v.receipt.status === 'collected' && <ActionButton label="รีเซ็ต (กลับเป็นรอเก็บเงิน)" variant="ghost" confirmText="รีเซ็ตใบเสร็จ? รายการเก็บเงินจะถูกกลับรายการ" action={resetReceipt.bind(null, id)} />}
          {W && v.receipt.status !== 'cancelled' && <ActionButton label="ยกเลิกใบเสร็จ" variant="danger" confirmText="ยกเลิกใบเสร็จ?" action={cancelReceipt.bind(null, id)} />}</ActsMenu>
      </div>
      <div className="detail">
        <ReceiptSheet v={v} />
        <aside className="side-panels noprint">
          {W && v.receipt.status === 'pending' && <CollectForm id={id} net={net} banks={banks} />}
          <section className="panel">
            <h3>ลิงก์แชร์</h3>
            {link ? (
              <>
                <p className="sub">ลูกค้าเปิดดู พิมพ์ และดาวน์โหลด PDF ได้โดยไม่ต้องล็อกอิน ใครมีลิงก์ก็เปิดได้</p>
                <CopyBox text={link} />
                <div className="acts" style={{ justifyContent: 'flex-start', marginTop: 8 }}>
                  <a className="btn sm ghost" href={link} target="_blank" rel="noreferrer">เปิดหน้าที่ลูกค้าเห็น</a>
                  {W && <ActionButton label="ยกเลิกลิงก์" variant="danger" confirmText="c" action={revokeReceiptShareLink.bind(null, id)} />}
                </div>
              </>
            ) : (
              <>
                <p className="sub">ยังไม่มีลิงก์ สร้างเพื่อส่งใบเสร็จให้ลูกค้าเปิดดูออนไลน์</p>
                {W ? <ActionButton label="สร้างลิงก์แชร์" action={createReceiptShareLink.bind(null, id)} /> : <p className="sub">ไม่มีสิทธิ์สร้างลิงก์</p>}
              </>
            )}
          </section>
        </aside>
      </div>
    </>
  );
}
