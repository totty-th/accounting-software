import { notFound } from 'next/navigation';
import { PurchaseDetailPage } from '@/components/PurchaseDetailPage';
export const dynamic = 'force-dynamic';
// /purchases/ri/{id} = หน้าใบรับสินค้า (PDF อยู่ที่ /purchases/{po|ri|pay|exp}/{id}/pdf)
export default function Page({ params }: { params: { kind: string; id: string } }) {
  if (params.kind !== 'ri') notFound();
  return <PurchaseDetailPage kind="RI" id={params.id} />;
}
