import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePage } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { getDb } from '@/lib/db';
import { money, dateTh, partyName } from '@/lib/format';
import { ActionButton } from '@/components/ActionButton';
import { reverseJv } from '@/lib/actions';

export const dynamic = 'force-dynamic';
export default async function Voucher({ params }: { params: { id: string } }) {
  const user = await requirePage('reports.read');
  const db = await getDb();
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) notFound();
  const [v] = await db.q<any>(`select v.*, c.business_name, c.contact_name, (select voucher_no from journal_vouchers r where r.reverses_id = v.id) reversed_by,
      (select voucher_no from journal_vouchers o where o.id = v.reverses_id) reverses_no from journal_vouchers v left join contacts c on c.id = v.contact_id where v.id = $1`, [params.id]);
  if (!v) notFound();
  const lines = await db.q<any>('select l.*, a.code, a.name from journal_lines l join accounts a on a.id = l.account_id where l.voucher_id = $1 order by l.line_no', [v.id]);
  const dr = lines.reduce((s, l) => s + Number(l.debit), 0), cr = lines.reduce((s, l) => s + Number(l.credit), 0);
  const canReverse = can(user.role, 'journal.write') && v.source_type === 'MANUAL' && !v.reverses_id && !v.reversed_by;
  return (
    <>
      <div className="top"><div><p className="sub"><Link href={`/journals?type=${v.voucher_type}`}>← สมุดรายวัน</Link></p><h1>{v.voucher_no}</h1></div>
        <div className="noprint" style={{ display: 'flex', gap: 8 }}>
          {canReverse && <ActionButton variant="danger" label="กลับรายการ" confirmText="สร้างใบกลับรายการ (-R) ยกเลิกใบสำคัญนี้" action={reverseJv.bind(null, v.id)} after={`/journals?type=${v.voucher_type}`} />}
        </div></div>
      {(v.reversed_by || v.reverses_id) && <div className="notice">{v.reversed_by ? `ใบสำคัญนี้ถูกกลับรายการแล้ว โดย ${v.reversed_by}` : `ใบกลับรายการของ ${v.reverses_no}`}</div>}
      <div className="panel"><ul className="rel">
        <li>วันที่เอกสาร: {dateTh(v.voucher_date)}</li>{(v.business_name || v.contact_name) && <li>ผู้ติดต่อ: {partyName(v)}</li>}
        {v.ref_no && <li>เลขที่อ้างอิง: {v.ref_no}</li>}{v.memo && <li>คำอธิบาย: {v.memo}</li>}{v.note && <li>โน้ตภายในบริษัท: {v.note}</li>}
        {v.source_type && v.source_type !== 'MANUAL' && <li>สร้างโดยระบบจากเอกสาร ({v.source_type}{v.source_id ? ` ${v.source_id}` : ''})</li>}</ul></div>
      <div className="panel" style={{ padding: 0, overflowX: 'auto' }}>
        <table><thead><tr><th>รหัสบัญชี</th><th>ชื่อบัญชี</th><th>คำอธิบาย</th><th className="num">เดบิต</th><th className="num">เครดิต</th></tr></thead>
          <tbody>{lines.map(l => <tr key={l.id}><td className="no">{l.code}</td><td>{l.name}</td><td>{l.description ?? ''}</td>
            <td className="num">{Number(l.debit) ? money(l.debit) : ''}</td><td className="num">{Number(l.credit) ? money(l.credit) : ''}</td></tr>)}
            <tr style={{ fontWeight: 700 }}><td /><td>ยอดรวมสุทธิ</td><td /><td className="num">{money(dr)}</td><td className="num">{money(cr)}</td></tr></tbody></table>
      </div>
    </>
  );
}
