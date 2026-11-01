import { notFound } from 'next/navigation';
import { requirePage } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { ClosingDoc } from '@/components/ClosingDoc';
export const dynamic = 'force-dynamic';
export default async function ClosingPage({ params, searchParams }: { params: { id: string }; searchParams: Record<string, string> }) {
  const user = await requirePage('reports.read');
  if (!/^[0-9a-f-]{36}$/.test(params.id)) notFound();
  const db = await getDb();
  if (!(await db.q('select 1 from period_closings where id=$1 and deleted_at is null', [params.id])).length) notFound();
  return <ClosingDoc id={params.id} q={searchParams} role={user.role} />;
}
