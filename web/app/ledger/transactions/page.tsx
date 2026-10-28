import { requirePage } from '@/lib/auth';
import { JournalList } from '@/components/JournalList';

export const dynamic = 'force-dynamic';
export default async function Transactions({ searchParams }: { searchParams: { q?: string; page?: string } }) {
  const user = await requirePage('reports.read');
  return (
    <>
      <div className="top"><div><h1>รายการเคลื่อนไหว</h1><p className="sub">ใบสำคัญทุกสมุด เรียงจากใหม่ไปเก่า</p></div></div>
      <JournalList type="ALL" q={searchParams.q ?? ''} page={Math.max(1, Number(searchParams.page) || 1)} role={user.role} base="/ledger/transactions" />
    </>
  );
}
