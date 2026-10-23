import Link from 'next/link';
import { notFound } from 'next/navigation';
import { headers } from 'next/headers';
import { getDb } from '@/lib/db';
import { loadView, DOC_TITLE } from '@/lib/doc-view';
import { DOC_TYPE } from '@/lib/status';
import { money, dateTh } from '@/lib/format';
import { Pill } from '@/components/Pill';
import { DocSheet } from '@/components/DocSheet';
import { SalesActions } from '@/components/SalesActions';
import { ActionButton } from '@/components/ActionButton';
import { CopyBox, PrintButton } from '@/components/ShareTools';
import { createShareLink, revokeShareLink } from '@/lib/actions';

export const dynamic = 'force-dynamic';

export default async function SalesDetail({ params }: { params: { id: string } }) {
  const v = await loadView(params.id);
  if (!v) notFound();
  const db = await getDb();
  const tok = (await db.q<{ t: string | null }>('select share_token as t from sales_docs where id=$1', [params.id]))[0]?.t;
  const h = headers(), host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  const link = tok ? `${proto}://${host}/s/${tok}` : null;
  const title = DOC_TITLE[v.doc.doc_type].title;
  const subject = `เอกสารเลขที่ ${v.doc.doc_no} จาก ${v.company?.name ?? ''}`;
  const body = `เรียน ${v.contact.name}\n\n${v.company?.name ?? ''} ขอส่ง${title} เลขที่ ${v.doc.doc_no} ยอดรวม ${money(v.doc.total)} บาท` +
    (link ? `\nดูและดาวน์โหลดเอกสารได้ที่ ${link}` : '') + `\n\nด้วยความเคารพ\n${v.company?.name ?? ''}`;
  return (
    <>
      <div className="top noprint">
        <div><h1>{v.doc.doc_no} <Pill s={v.doc.status} /></h1>
          <p className="sub"><Link href={`/sales?type=${v.doc.doc_type}`}>← {DOC_TYPE[v.doc.doc_type]}</Link></p></div>
        <div className="acts">
          <PrintButton />
          <a className="btn ghost" href={`/sales/${params.id}/pdf`}>ดาวน์โหลด PDF</a>
          <a className="btn ghost" href={`/sales/${params.id}/pdf?both=1`}>PDF ต้นฉบับ+สำเนา</a>
          <SalesActions d={v.doc} />
        </div>
      </div>
      <div className="detail">
        <DocSheet v={v} />
        <aside className="side-panels noprint">
          <section className="panel">
            <h3>ลิงก์แชร์</h3>
            {link ? (
              <>
                <p className="sub">ลูกค้าเปิดดู พิมพ์ และดาวน์โหลด PDF ได้โดยไม่ต้องล็อกอิน ใครมีลิงก์ก็เปิดได้</p>
                <CopyBox text={link} />
                <div className="acts" style={{ justifyContent: 'flex-start', marginTop: 8 }}>
                  <a className="btn sm ghost" href={link} target="_blank" rel="noreferrer">เปิดหน้าที่ลูกค้าเห็น</a>
                  <ActionButton label="ยกเลิกลิงก์" variant="danger" confirmText="c" action={revokeShareLink.bind(null, params.id)} />
                </div>
              </>
            ) : (
              <>
                <p className="sub">ยังไม่มีลิงก์ สร้างเพื่อส่งให้ลูกค้าเปิดดูเอกสารออนไลน์</p>
                <ActionButton label="สร้างลิงก์แชร์" action={createShareLink.bind(null, params.id)} />
              </>
            )}
          </section>
          <section className="panel">
            <h3>ข้อความอีเมล</h3>
            <p className="sub">ระบบยังไม่ส่งอีเมลให้เอง คัดลอกข้อความไปส่ง หรือกดเปิดในโปรแกรมอีเมลของคุณ</p>
            <CopyBox text={subject} label="คัดลอกหัวข้อ" />
            <textarea readOnly rows={7} value={body} style={{ width: '100%', marginTop: 8 }} />
            <div className="acts" style={{ justifyContent: 'flex-start', marginTop: 8 }}>
              <CopyBox text={body} label="คัดลอกข้อความ" />
              <a className="btn sm ghost" href={`mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`}>เปิดในโปรแกรมอีเมล</a>
            </div>
          </section>
          <section className="panel">
            <h3>เอกสารที่เกี่ยวข้อง</h3>
            <ul className="rel">
              {v.ref && <li>มาจาก <Link href={`/sales/${v.ref.id}`}>{v.ref.doc_no}</Link> ({DOC_TYPE[v.ref.doc_type]})</li>}
              {v.children.map(c => <li key={c.id}>สร้างต่อเป็น <Link href={`/sales/${c.id}`}>{c.doc_no}</Link> ({DOC_TYPE[c.doc_type]}) <Pill s={c.status} /></li>)}
              {v.receipts.map(r => <li key={r.id}>ใบเสร็จ {r.receipt_no} {money(r.amount)} <Pill s={r.status} />{r.collected_date ? ` เก็บเงิน ${dateTh(r.collected_date)}` : ''}</li>)}
              {!v.ref && !v.children.length && !v.receipts.length && <li className="sub">ยังไม่มี</li>}
            </ul>
            {v.vouchers.length > 0 && <p className="sub">ลงบัญชีที่ใบสำคัญ {v.vouchers.map(x => x.voucher_no).join(', ')}</p>}
          </section>
        </aside>
      </div>
    </>
  );
}
