import Link from 'next/link';
import { getDb } from '@/lib/db';
import { money, dateTh, partyName } from '@/lib/format';
import { Pill } from '@/components/Pill';
import { Group } from '@/components/Board';
import { SalesActions } from '@/components/SalesActions';
import { DOC_TYPE, STATUS } from '@/lib/status';

const ORDER = ['pending_approval', 'approved', 'awaiting_payment', 'pending_collect', 'split_paid', 'deposit_paid', 'receipt_opened',
  'billed', 'active', 'collected', 'converted', 'cancelled'];
const COLOR: Record<string, string> = { green: 'var(--green)', orange: 'var(--orange)', blue: 'var(--blue)', purple: 'var(--purple)',
  red: 'var(--red)', grey: 'var(--grey)', teal: 'var(--teal)' };

export default async function Sales({ searchParams }: { searchParams: { type?: string } }) {
  const type = searchParams.type && DOC_TYPE[searchParams.type] ? searchParams.type : '';
  const db = await getDb();
  const rows = await db.q(`select d.id, d.doc_type, d.doc_no, d.doc_date, d.status, d.total, d.is_deposit, c.business_name, c.contact_name
    from sales_docs d join contacts c on c.id=d.contact_id where ($1 = '' or d.doc_type = $1) order by d.doc_date desc, d.doc_no desc`, [type]);
  const groups = ORDER.map(s => [s, rows.filter(r => r.status === s)] as const).filter(([, r]) => r.length);
  return (
    <>
      <div className="top"><div><h1>เอกสารขาย</h1><p className="sub">สร้างเอกสารแล้วลงบัญชีอัตโนมัติ</p></div>
        <Link className="btn" href={`/sales/new?type=${type || 'INV'}`}>+ {DOC_TYPE[type || 'INV']}ใหม่</Link></div>
      <div className="tabs">
        <Link href="/sales" className={!type ? 'on' : ''}>ทั้งหมด</Link>
        {Object.entries(DOC_TYPE).map(([k, v]) => <Link key={k} href={`/sales?type=${k}`} className={type === k ? 'on' : ''}>{v}</Link>)}
      </div>
      {type === 'CN' || type === 'DN' || type === 'BL' ? <div className="notice">ใบ{DOC_TYPE[type].replace('ใบ', '')}สร้างจากใบแจ้งหนี้ (กำลังเพิ่มปุ่มในหน้านี้)</div> : null}
      {groups.length === 0 && <div className="panel empty">ยังไม่มีเอกสาร กด “+ เอกสารใหม่” ด้านบน</div>}
      {groups.map(([s, rs]) => (
        <Group key={s} title={STATUS[s][0]} color={COLOR[STATUS[s][1]]} count={rs.length}>
          <table><thead><tr><th>เลขที่</th><th>ประเภท</th><th>ลูกค้า</th><th>วันที่</th><th className="num">ยอดรวม</th><th>สถานะ</th><th /></tr></thead>
            <tbody>{rs.map(r => (
              <tr key={r.id}><td className="no"><Link href={`/sales/${r.doc_no}`}>{r.doc_no}</Link></td><td>{DOC_TYPE[r.doc_type]}{r.is_deposit ? ' (มัดจำ)' : ''}</td><td>{partyName(r)}</td>
                <td>{dateTh(r.doc_date)}</td><td className="num">{money(r.total)}</td><td><Pill s={r.status} /></td><td><SalesActions d={r} /></td></tr>))}</tbody></table>
        </Group>))}
    </>
  );
}
