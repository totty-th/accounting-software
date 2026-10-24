'use client';
import { ActionButton } from './ActionButton';
import { CopyBox } from './ShareTools';
import { sharePurchaseDoc, unsharePurchaseDoc } from '@/lib/actions';

/** PDF + ลิงก์แชร์สำหรับ PO / RI / PAY */
export function PurchaseDocTools({ kind, id, token, canWrite }: { kind: 'PO' | 'RI' | 'PAY'; id: string; token: string | null; canWrite: boolean }) {
  const url = token && typeof window !== 'undefined' ? `${window.location.origin}/p/${token}/pdf` : token ? `/p/${token}/pdf` : '';
  return (
    <div className="acts" style={{ flexWrap: 'wrap' }}>
      <a className="btn sm ghost" href={`/purchases/${kind.toLowerCase()}/${id}/pdf`} target="_blank">PDF</a>
      {canWrite && !token && <ActionButton label="สร้างลิงก์แชร์" variant="ghost" action={sharePurchaseDoc.bind(null, kind, id)} />}
      {token && <><CopyBox text={url} label="คัดลอกลิงก์" />
        {canWrite && <ActionButton label="ยกเลิกลิงก์" variant="danger" confirmText="c" action={unsharePurchaseDoc.bind(null, kind, id)} />}</>}
    </div>
  );
}
