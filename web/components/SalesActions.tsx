import { ActionButton } from '@/components/ActionButton';
import * as A from '@/lib/actions';

// ปุ่มต่อยอด/เปลี่ยนสถานะของเอกสารขาย (ใช้ทั้งหน้ารายการและหน้ารายละเอียด)
export function SalesActions({ d }: { d: any }) {
  const b = (label: string, fn: () => Promise<any>, v: '' | 'ghost' | 'danger' = 'ghost', confirmText?: string) =>
    <ActionButton key={label} label={label} variant={v} confirmText={confirmText} action={fn} />;
  const cancel = b('ยกเลิก', A.cancelSalesDoc.bind(null, d.id), 'danger', 'c');
  const s = d.status as string;
  const out: React.ReactNode[] = [];
  if (d.doc_type === 'INV' && (s === 'awaiting_payment' || s === 'split_paid')) out.push(b('สร้างใบเสร็จ', A.createReceipt.bind(null, d.id), ''));
  if (d.doc_type === 'QT' && s === 'pending_approval') out.push(b('อนุมัติ', A.approveQuote.bind(null, d.id), ''));
  if (d.doc_type === 'QT' && s === 'approved') out.push(b('สร้างใบแจ้งหนี้', A.quoteToInvoice.bind(null, d.id), ''));
  if (d.doc_type === 'CA' && s === 'pending_collect') out.push(b('เก็บเงิน', A.collectCash.bind(null, d.id), ''));
  if (d.doc_type === 'CA' && s === 'collected') out.push(b('รีเซ็ต', A.resetCash.bind(null, d.id)));
  if (s !== 'cancelled' && s !== 'converted') out.push(cancel);
  return <div className="acts">{out}</div>;
}
