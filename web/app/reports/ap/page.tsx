import { requirePage } from '@/lib/auth';
import { AgingReport } from '@/components/AgingReport';
export const dynamic = 'force-dynamic';
export default async function Page({ searchParams }: { searchParams: { asof?: string; contact?: string; coa?: string } }) {
  await requirePage('reports.read');
  return <AgingReport kind="ap" sp={searchParams} />;
}
