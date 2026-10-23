import { AgingReport } from '@/components/AgingReport';
export const dynamic = 'force-dynamic';
export default function Page({ searchParams }: { searchParams: { asof?: string; contact?: string; coa?: string } }) {
  return <AgingReport kind="ap" sp={searchParams} />;
}
