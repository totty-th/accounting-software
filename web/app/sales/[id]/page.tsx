import Link from 'next/link';
import { notFound } from 'next/navigation';
import { headers } from 'next/headers';
import { getDb } from '@/lib/db';
import { loadView, DOC_TITLE } from '@/lib/doc-view';
import { DOC_TYPE } from '@/lib/status';
import { money, dateTh } from '@/lib/format';
import { ActsMenu } from '@/components/ActsMenu';
import { Pill } from '@/components/Pill';
import { DocSheet } from '@/components/DocSheet';
import { SalesActions } from '@/components/SalesActions';
import { ActionButton } from '@/components/ActionButton';
import { CopyBox, PrintButton } from '@/components/ShareTools';
import { createShareLink, revokeShareLink, closeQuotation, reopenQuotation } from '@/lib/actions';
import { requirePage, canViewSalesDoc } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { NoteBox, FileUpload, FileRemove, WhtPick, DeliveryForm } from '@/components/DocExtras';
import { STATUS } from '@/lib/status';

const EV: Record<string, string> = { delivery: 'แก้ข้อมูลจัดส่ง', created: 'สร้างเอกสาร', status: 'เปลี่ยนสถานะ', note: 'แก้ไขโน้ตภายใน', file_added: 'แนบไฟล์', file_removed: 'ลบไฟล์แนบ', wht: 'เปลี่ยนอัตราหัก ณ ที่จ่าย' };

export const dynamic = 'force-dynamic';

export default async function SalesDetail({ params }: { params: { id: string } }) {
  const user = await requirePage(['sales.read', 'quote.own']);
  const v = await loadView(params.id);
  if (!v || !(await canViewSalesDoc(user, v.doc.id))) notFound();
  const canWrite = can(user.role, 'sales.write') || can(user.role, 'quote.own');
  const db = await getDb();
  const tok = (await db.q<{ t: string | null }>('select share_token as t from sales_docs where id=$1', [v.doc.id]))[0]?.t;
  const h = headers(), host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  const link = tok ? `${proto}://${host}/s/${tok}` : null;
  const x = (await db.q<any>('select internal_note, wht_rate from sales_docs where id=$1', [v.doc.id]))[0];
  const files = await db.q<any>('select id, filename, size from sales_doc_files where doc_id=$1 order by created_at', [v.doc.id]);
  const events = await db.q<any>(`select e.event, e.detail, e.at, u.display_name from doc_events e left join app_users u on u.id=e.actor_id
    where e.doc_id=$1 order by e.id desc`, [v.doc.id]);
  const editText = (raw: string) => { try { const x = JSON.parse(raw); const b = x.before, a = x.after; const ch: string[] = [];
      if (Number(b.total) !== Number(a.total)) ch.push(`ยอดรวม ${money(b.total)} → ${money(a.total)}`);
      if (String(b.date).slice(0, 10) !== String(a.date).slice(0, 10)) ch.push(`วันที่ ${dateTh(b.date)} → ${dateTh(a.date)}`);
      if (b.contact !== a.contact) ch.push(`ลูกค้า ${b.contact} → ${a.contact}`);
      if (JSON.stringify(b.lines) !== JSON.stringify(a.lines)) ch.push(`รายการ ${b.lines.length} → ${a.lines.length} บรรทัด`);
      for (const [k, t] of [['ref_no', 'เลขอ้างอิง'], ['project', 'โปรเจ็ค'], ['description', 'รายละเอียด'], ['note', 'หมายเหตุ'], ['internal_note', 'โน้ตภายใน'], ['salesperson', 'พนักงานขาย']] as const)
        if ((b[k] ?? '') !== (a[k] ?? '')) ch.push(`${t} "${b[k] ?? ''}" → "${a[k] ?? ''}"`);
      return `แก้ไขเอกสาร: ${ch.join(' · ') || 'ข้อมูลทั่วไป'}`; } catch { return 'แก้ไขเอกสาร'; } };
  const evText = (e: any) => e.event === 'edit' ? editText(e.detail) : e.event === 'delivery' ? (e.detail === 'pickup' ? 'ข้อมูลจัดส่ง: ลูกค้ามารับเอง' : e.detail === 'ship' ? 'ข้อมูลจัดส่ง: ส่งให้ลูกค้า' : 'ล้างข้อมูลจัดส่ง') : e.event === 'status' ? `${EV.status}: ${String(e.detail).split('>').map((t: string) => STATUS[t]?.[0] ?? t).join(' → ')}`
    : e.event === 'wht' ? `${EV.wht}: ${String(e.detail).replace('>', '% → ')}%` : e.detail && e.event.startsWith('file') ? `${EV[e.event]}: ${e.detail}` : EV[e.event] ?? e.event;
  const dlvOk = (v.doc.doc_type === 'QT' && ['approved', 'converted'].includes(v.doc.status)) || (v.doc.doc_type === 'INV' && v.doc.status !== 'cancelled');
  const bill = v.doc.doc_type === 'QT' ? (await db.q<any>('select quotation_billing_summary($1) as s', [v.doc.id]))[0].s : null;
  const title = DOC_TITLE[v.doc.doc_type].title;
  const subject = `เอกสารเลขที่ ${v.doc.doc_no} จาก ${v.company?.name ?? ''}`;
  const body = `เรียน ${v.contact.name}\n\n${v.company?.name ?? ''} ขอส่ง${title} เลขที่ ${v.doc.doc_no} ยอดรวม ${money(v.doc.total)} บาท` +
    (link ? `\nดูและดาวน์โหลดเอกสารได้ที่ ${link}` : '') + `\n\nด้วยความเคารพ\n${v.company?.name ?? ''}`;
  return (
    <>
      <div className="top noprint">
        <div><h1>{v.doc.doc_no} <Pill s={v.doc.status} /></h1>
          <p className="sub"><Link href={`/sales?type=${v.doc.doc_type}`}>← {DOC_TYPE[v.doc.doc_type]}</Link></p></div>
        <ActsMenu>
          <PrintButton />
          <a className="btn ghost" href={`/sales/${v.doc.doc_no}/pdf`}>ดาวน์โหลด PDF</a>
          <a className="btn ghost" href={`/sales/${v.doc.doc_no}/pdf?both=1`}>PDF ต้นฉบับ+สำเนา</a>
          {dlvOk && <a className="btn ghost" href={`/sales/${v.doc.doc_no}/delivery`}>พิมพ์ใบส่งของ</a>}
          <SalesActions d={v.doc} role={user.role} detail />
        </ActsMenu>
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
                  {canWrite && <ActionButton label="ยกเลิกลิงก์" variant="danger" confirmText="c" action={revokeShareLink.bind(null, v.doc.id)} />}
                </div>
              </>
            ) : (
              <>
                <p className="sub">ยังไม่มีลิงก์ สร้างเพื่อส่งให้ลูกค้าเปิดดูเอกสารออนไลน์</p>
                {canWrite ? <ActionButton label="สร้างลิงก์แชร์" action={createShareLink.bind(null, v.doc.id)} /> : <p className="sub">ไม่มีสิทธิ์สร้างลิงก์</p>}
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
          {v.doc.doc_type === 'DN' && (
            <section className="panel">
              <h3>หัก ณ ที่จ่าย</h3>
              <p className="sub">ลูกค้าหักเรา คิดจากมูลค่าก่อน VAT ของใบนี้ แก้ได้ก่อนมีใบเสร็จ</p>
              <WhtPick id={v.doc.id} rate={Number(x.wht_rate)} canEdit={can(user.role, 'sales.write') && v.doc.status !== 'cancelled'} />
            </section>)}
          {bill && (bill.docs.length > 0 || bill.closeouts.length > 0 || ['approved', 'partial', 'converted'].includes(v.doc.status)) && <section className="panel">
            <h3>การเรียกเก็บเงิน</h3>
            <ul className="rel">
              <li>มูลค่าใบเสนอราคา: <b>{money(bill.total)}</b></li>
              <li>เรียกเก็บแล้ว: <b>{money(bill.billed)}</b></li>
              {Number(bill.closed) > 0 && <li>ปิดยอดโดยไม่ออกเอกสาร: <b>{money(bill.closed)}</b></li>}
              <li>ยังไม่ได้เรียกเก็บ: <b>{money(bill.remaining)}</b></li>
              <li>สถานะการเรียกเก็บ: <b>{Number(bill.percent)}%</b></li>
            </ul>
            <ul className="rel">
              {bill.docs.map((d: any) => <li key={d.id}><Link href={`/sales/${d.doc_no}`}>{d.doc_no}</Link> ({DOC_TYPE[d.doc_type]}{d.is_deposit ? ' มัดจำ' : ''}) {dateTh(d.doc_date)} · {money(d.total)} <Pill s={d.status} /></li>)}
              {bill.closeouts.map((c: any) => <li key={c.id}>ปิดยอดคงเหลือ {money(c.amount)} (ไม่ออกเอกสาร){canWrite && <> <ActionButton label="ยกเลิกการเก็บเงิน" variant="ghost" action={reopenQuotation.bind(null, v.doc.id)} /></>}</li>)}
              {!bill.docs.length && !bill.closeouts.length && <li className="sub">ยังไม่มีเอกสารที่ออกจากใบนี้</li>}
            </ul>
            {canWrite && v.doc.status === 'partial' && Number(bill.remaining) > 0 && <div className="acts" style={{ justifyContent: 'flex-start', marginTop: 8 }}>
              <ActionButton label="เก็บเงินทั้งหมด (ปิดยอดที่เหลือ)" variant="ghost" confirmText="c" action={closeQuotation.bind(null, v.doc.id)} /></div>}
          </section>}
          {dlvOk && <section className="panel">
            <h3>ข้อมูลจัดส่ง (ใบส่งของ)</h3>
            <p className="sub">ฝ่ายขายกรอกว่าลูกค้ามารับเอง หรือส่งที่ไหน ถึงใคร ผ่านขนส่งอะไร — ที่อยู่ส่งต่างจากที่อยู่เปิดบิลได้ แล้วกด "พิมพ์ใบส่งของ"</p>
            <DeliveryForm id={v.doc.id} d={v.doc} canEdit={canWrite} />
          </section>}
          <section className="panel">
            <h3>โน้ตภายในบริษัท</h3>
            <NoteBox id={v.doc.id} note={x.internal_note ?? ''} canEdit={canWrite} />
          </section>
          <section className="panel">
            <h3>ไฟล์แนบ</h3>
            <ul className="rel">
              {files.map((f: any) => <li key={f.id}><a href={`/sales/file/${f.id}`}>{f.filename}</a> <span className="sub">{Math.ceil(f.size / 1024)} KB</span> {canWrite && <FileRemove docId={v.doc.id} fileId={f.id} />}</li>)}
              {!files.length && <li className="sub">ยังไม่มีไฟล์แนบ</li>}
            </ul>
            {canWrite && <FileUpload id={v.doc.id} />}
          </section>
          <section className="panel">
            <h3>ประวัติเอกสาร</h3>
            <ul className="rel">
              {events.map((e: any, i: number) => <li key={i}>{evText(e)} <span className="sub">{new Date(e.at).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok' })} · {e.display_name ?? 'ระบบ'}</span></li>)}
            </ul>
          </section>
          <section className="panel">
            <h3>เอกสารที่เกี่ยวข้อง</h3>
            <ul className="rel">
              {v.ref && <li>มาจาก <Link href={`/sales/${v.ref.doc_no}`}>{v.ref.doc_no}</Link> ({DOC_TYPE[v.ref.doc_type]})</li>}
              {v.children.map(c => <li key={c.id}>สร้างต่อเป็น <Link href={`/sales/${c.doc_no}`}>{c.doc_no}</Link> ({DOC_TYPE[c.doc_type]}) <Pill s={c.status} /></li>)}
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
