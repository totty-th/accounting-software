import Link from 'next/link';
import { getDb } from '@/lib/db';
import { money, dateTh } from '@/lib/format';
import { can, type Role } from '@/lib/permissions';
import { ActionButton } from './ActionButton';
import { deleteJvDraft } from '@/lib/actions';

export const BOOKS: [string, string][] = [['JV', 'สมุดรายวันทั่วไป'], ['UV', 'สมุดรายวันซื้อ'], ['SV', 'สมุดรายวันขาย'], ['PV', 'สมุดรายวันจ่าย'], ['RV', 'สมุดรายวันรับ']];
const STATUS: Record<string, [string, string]> = { normal: ['อนุมัติแล้ว', 'var(--green)'], reversed: ['ถูกกลับรายการ', 'var(--red)'], reversal: ['ใบกลับรายการ', 'var(--red)'] };
const PAGE = 20;

/** รายการสมุดรายวัน (type = JV/UV/SV/PV/RV) หรือรายการเคลื่อนไหวทั้งหมด (type = ALL) */
export async function JournalList({ type, q, page, role, base }: { type: string; q: string; page: number; role: Role; base: string }) {
  const db = await getDb();
  const all = type === 'ALL';
  const rows = await db.q<any>('select * from journal_list($1::text[], null, null, $2, $3, $4)', [all ? null : [type], q, PAGE, (page - 1) * PAGE]);
  const total = Number(rows[0]?.total_rows ?? 0), pages = Math.max(1, Math.ceil(total / PAGE));
  const drafts = type === 'JV' && !q ? await db.q<any>('select id, draft_no, doc_date, memo, lines from jv_drafts order by created_at desc') : [];
  const writable = can(role, 'journal.write');
  const href = (p: number) => `${base}${base.includes('?') ? '&' : '?'}${q ? `q=${encodeURIComponent(q)}&` : ''}page=${p}`;
  return (
    <>
      <form className="noprint" style={{ margin: '0 0 10px', display: 'flex', gap: 8 }} action={base.split('?')[0]}>
        {all ? null : <input type="hidden" name="type" value={type} />}
        <input name="q" defaultValue={q} placeholder="ค้นหาเลขที่เอกสาร / คำอธิบาย / เลขอ้างอิง" style={{ flex: 1, minWidth: 0 }} /><button className="btn sm">ค้นหา</button>
      </form>
      <div className="panel" style={{ padding: 0, overflowX: 'auto' }}>
        <table><thead><tr><th>วันที่</th><th>เลขที่เอกสาร</th>{all && <th>สมุด</th>}<th>คำอธิบายรายการย่อย</th><th className="num">ยอดรวมสุทธิ</th><th>สถานะ</th><th /></tr></thead>
          <tbody>
            {drafts.map(d => <tr key={d.id}><td>{d.doc_date ? dateTh(d.doc_date) : '-'}</td><td className="no"><Link href={`/journals/new?draft=${d.id}`}>{d.draft_no}</Link></td><td>{d.memo ?? ''}</td>
              <td className="num">{money((d.lines as any[]).reduce((s, l) => s + Number(l.debit ?? 0), 0))}</td><td><span className="pill">ฉบับร่าง</span></td>
              <td>{writable && <ActionButton variant="ghost" label="ลบร่าง" confirmText="ลบร่างนี้?" action={deleteJvDraft.bind(null, d.id)} />}</td></tr>)}
            {rows.map(r => { const st = STATUS[r.status]; const dim = r.status !== 'normal';
              return <tr key={r.id} style={dim ? { opacity: 0.6 } : undefined}><td>{dateTh(r.voucher_date)}</td><td className="no"><Link href={`/journals/${r.id}`}>{r.voucher_no}</Link></td>
                {all && <td>{BOOKS.find(b => b[0] === r.voucher_type)?.[1].replace('สมุดรายวัน', '') ?? 'ปิดบัญชี'}</td>}
                <td>{r.memo ?? ''}</td><td className="num">{money(r.total)}</td><td><span style={{ color: st[1] }}>{st[0]}</span></td><td><Link className="btn sm ghost" href={`/journals/${r.id}`}>ดู</Link></td></tr>; })}
            {rows.length + drafts.length === 0 && <tr><td colSpan={all ? 7 : 6} className="empty">ไม่พบรายการ</td></tr>}
          </tbody></table>
      </div>
      {pages > 1 && <p className="sub noprint" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        {page > 1 && <Link href={href(page - 1)}>‹ ก่อนหน้า</Link>}<span>หน้า {page} / {pages} · ทั้งหมด {total} รายการ</span>{page < pages && <Link href={href(page + 1)}>ถัดไป ›</Link>}</p>}
    </>
  );
}
