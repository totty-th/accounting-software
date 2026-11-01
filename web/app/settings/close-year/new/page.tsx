import { requirePage } from '@/lib/auth';
import { ClosingDoc } from '@/components/ClosingDoc';
export const dynamic = 'force-dynamic';
export default async function NewClosing({ searchParams }: { searchParams: Record<string, string> }) {
  const user = await requirePage('reports.read');
  return <ClosingDoc q={searchParams} role={user.role} />;
}
