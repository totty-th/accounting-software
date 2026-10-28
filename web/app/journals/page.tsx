import Link from 'next/link';
import { requirePage } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { BOOKS, JournalList } from '@/components/JournalList';

export const dynamic = 'force-dynamic';
export default async function Journals({ searchParams }: { searchParams: { type?: string; q?: string; page?: string } }) {
  const user = await requirePage('reports.read');
  const type = BOOKS.some(b => b[0] === searchParams.type) ? searchParams.type! : 'JV';
  const page = Math.max(1, Number(searchParams.page) || 1);
  return (
    <>
      <div className="top"><div><h1>สมุดรายวัน</h1><p className="sub">ใบสำคัญที่ลงบัญชีแล้ว แยกตามสมุด · แก้ไขหรือลบไม่ได้ ยกเลิกด้วยใบกลับรายการ (-R)</p></div>
        {type === 'JV' && can(user.role, 'journal.write') && <Link className="btn" href="/journals/new">สร้างใหม่</Link>}</div>
      <div className="tabs noprint">{BOOKS.map(([k, l]) => <Link key={k} href={`/journals?type=${k}`} className={type === k ? 'on' : ''}>{l.replace('สมุดรายวัน', '')}</Link>)}</div>
      <JournalList type={type} q={searchParams.q ?? ''} page={page} role={user.role} base={`/journals?type=${type}`} />
    </>
  );
}
