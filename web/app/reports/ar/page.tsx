import { AgingReport } from '@/components/AgingReport';
export const dynamic = 'force-dynamic';
export default function Page({ searchParams }: { searchParams: { asof?: string; contact?: string } }) {
  return <AgingReport kind="ar" sp={searchParams} />;
}
