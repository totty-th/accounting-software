import { PurchaseDetailPage } from '@/components/PurchaseDetailPage';
export const dynamic = 'force-dynamic';
export default function Page({ params }: { params: { id: string } }) { return <PurchaseDetailPage kind="PO" id={params.id} />; }
