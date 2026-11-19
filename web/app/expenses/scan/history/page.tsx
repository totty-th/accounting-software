import Link from 'next/link';
import { requirePage } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { getDb } from '@/lib/db';
import { money, dateTh } from '@/lib/format';
import { ActionButton } from '@/components/ActionButton';
import { restoreScan } from '@/lib/actions';

export const dynamic = 'force-dynamic';
const ST: Record<string, [string, string]> = { pending: ['รอบันทึก', 'orange'], saved: ['บันทึกแล้ว', 'green'], discarded: ['ยกเลิก', ''] };

/** M71 ประวัติไฟล์ที่อัปโหลด */
export default async function ScanHistory({ searchParams }: { searchParams: { s?: string } }) {
  const user = await requirePage(['expenses.read', 'expenses.write']);
  const W = can(user.role, 'expenses.write');
  const f = ['pending', 'saved', 'discarded'].includes(searchParams.s ?? '') ? searchParams.s! : null;
  const rows = await (await getDb()).q<any>(`select s.id, s.filename, s.status, s.scanned_no, s.doc_date, s.vendor_name, s.total, s.created_at, s.expense_id, e.exp_no,
      (select string_agg(distinct coalesce(a.name, l.account_code), ', ') from expense_lines l left join accounts a on a.code=l.account_code where l.expense_id=s.expense_id) cats
    from doc_scans s left join expenses e on e.id=s.expense_id where ($1::text is null or s.status=$1) order by s.created_at desc limit 500`, [f]);
  const tab = (k: string | null, t: string) => <Link className={`btn sm ${f === k ? '' : 'ghost'}`} href={k ? `?s=${k}` : '?'}>{t}</Link>;
  return (<>
    <div className="top"><div><h1>ประวัติบันทึกจากรูปบิล/PDF</h1><p className="sub"><Link href="/expenses/scan">← กลับไปหน้าบันทึก</Link></p></div></div>
    <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>{tab(null, 'ทั้งหมด')}{tab('pending', 'รอบันทึก')}{tab('saved', 'บันทึกแล้ว')}{tab('discarded', 'ยกเลิก')}</div>
    <div className="panel" style={{ overflowX: 'auto' }}>
      <table className="tbl"><thead><tr><th>ไฟล์</th><th>เลขที่บิล</th><th>ค่าใช้จ่าย</th><th>วันที่</th><th>ผู้จำหน่าย</th><th>หมวด</th><th className="num">ยอดรวม</th><th>สถานะ</th><th /></tr></thead>
        <tbody>{rows.length ? rows.map(r => <tr key={r.id}>
          <td><a href={`/expenses/scan/file/${r.id}?inline=1`} target="_blank" rel="noreferrer">{r.filename}</a></td>
          <td>{r.scanned_no ?? '-'}</td>
          <td>{r.expense_id ? <Link href={`/expenses/${r.expense_id}`}>{r.exp_no}</Link> : '-'}</td>
          <td>{r.doc_date ? dateTh(r.doc_date) : '-'}</td><td>{r.vendor_name ?? '-'}</td><td>{r.cats ?? '-'}</td>
          <td className="num">{r.total != null ? money(r.total) : '-'}</td>
          <td><span className={`pill ${ST[r.status][1]}`}>{ST[r.status][0]}</span></td>
          <td>{W && r.status === 'discarded' && <ActionButton action={restoreScan.bind(null, r.id)} label="นำกลับมา" variant="ghost" />}</td>
        </tr>) : <tr><td colSpan={9} className="sub">ยังไม่มีไฟล์</td></tr>}</tbody></table>
    </div>
  </>);
}
