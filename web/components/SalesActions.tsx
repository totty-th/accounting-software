import { ActsMenu } from '@/components/ActsMenu';
import { ActionButton } from '@/components/ActionButton';
import * as A from '@/lib/actions';
import { can, type Role } from '@/lib/permissions';

// ปุ่มต่อยอด/เปลี่ยนสถานะของเอกสารขาย (ใช้ทั้งหน้ารายการและหน้ารายละเอียด)
export function SalesActions({ d, role, detail = false }: { d: any; role: Role; detail?: boolean }) {
  const W = can(role, 'sales.write');
  const b = (label: string, fn: () => Promise<any>, v: '' | 'ghost' | 'danger' = 'ghost', confirmText?: string) =>
    <ActionButton key={label} label={label} variant={v} confirmText={confirmText} action={fn} />;
  const cancel = b('ยกเลิก', A.cancelSalesDoc.bind(null, d.id), 'danger', 'c');
  const s = d.status as string;
  const out: React.ReactNode[] = [];
  if (can(role, 'receipts.write') && d.doc_type === 'INV' && (s === 'awaiting_payment' || s === 'split_paid')) out.push(b('สร้างใบเสร็จ', A.createReceipt.bind(null, d.id), ''));
  if (W && d.doc_type === 'INV' && s === 'awaiting_payment' && d.doc_no) {
    out.push(<a key="dn" className="btn sm ghost" href={`/sales/adjust?type=DN&ref=${d.doc_no}`}>ออกใบเพิ่มหนี้</a>);
    out.push(<a key="cn" className="btn sm ghost" href={`/sales/adjust?type=CN&ref=${d.doc_no}`}>ออกใบลดหนี้</a>);
  }
  if (can(role, 'sales.approve') && d.doc_type === 'QT' && s === 'pending_approval') out.push(b('อนุมัติ', A.approveQuote.bind(null, d.id), ''));
  if (can(role, 'sales.approve') && d.doc_type === 'QT' && (s === 'pending_approval' || s === 'approved')) out.push(b('ไม่อนุมัติ', A.rejectQuote.bind(null, d.id), 'ghost', 'c'));
  if (can(role, 'sales.approve') && d.doc_type === 'QT' && (['rejected','approved','partial','converted'].includes(s))) out.push(b('รีเซ็ต', A.resetQuote.bind(null, d.id)));
  if ((W || can(role, 'quote.own')) && d.doc_type === 'QT' && s === 'pending_approval' && d.doc_no)
    out.push(<a key="qe" className="btn sm ghost" href={`/sales/${d.doc_no}/edit`}>แก้ไข</a>);
  if (W && d.doc_type === 'INV' && s !== 'cancelled' && d.doc_no && !d.is_deposit) out.push(<a key="ie" className="btn sm ghost" href={`/sales/${d.doc_no}/edit`}>แก้ไข</a>);
  if ((W || can(role, 'quote.own')) && d.doc_type === 'QT') out.push(b('สร้างซ้ำ', A.duplicateQuote.bind(null, d.id)));
  if (W && d.doc_type === 'INV' && s !== 'cancelled') out.push(b('สร้างซ้ำ', A.duplicateInvoice.bind(null, d.id)));
  if (W && d.doc_type === 'QT' && ['pending_approval', 'approved', 'partial'].includes(s)) {   // M18.11: ข้ามการอนุมัติได้ (ตาม FA)
    out.push(b(s === 'partial' ? 'ออกใบแจ้งหนี้ที่เหลือ' : 'สร้างใบแจ้งหนี้', A.quoteToInvoice.bind(null, d.id), ''));
    if (detail) {
      out.push(b('สร้างขายสด', A.billQuotation.bind(null, d.id, 'CA'), 'ghost'));
      if (s !== 'partial') out.push(b('สร้างใบวางบิล', A.billQuotation.bind(null, d.id, 'BL'), 'ghost'));
      if (d.doc_no) out.push(<a key="sp" className="btn sm ghost" href={`/sales/${d.doc_no}/split`}>แบ่งจ่าย</a>);
    }
  }
  if (W && d.doc_type === 'QT' && s === 'approved') out.push(b('ดำเนินการแล้ว', A.closeQuotation.bind(null, d.id), 'ghost', 'c'));
  if (W && d.doc_type === 'CA' && s === 'pending_collect') out.push(b('เก็บเงิน', A.collectCash.bind(null, d.id), ''));
  if (W && d.doc_type === 'CA' && s === 'collected') out.push(b('รีเซ็ต', A.resetCash.bind(null, d.id)));
  if (W && d.doc_type === 'BL' && d.is_deposit && s === 'billed') out.push(b('สร้างใบแจ้งหนี้มัดจำ (ลงบัญชี)', A.convertDepositBl.bind(null, d.id), ''));
  if (W && (d.doc_type === 'CN' || d.doc_type === 'DN') && s === 'cancelled') out.push(b('รีเซ็ต', A.restoreSalesDoc.bind(null, d.id), '', 'c'));
  if ((W || (can(role, 'quote.own') && d.doc_type === 'QT')) && s !== 'cancelled' && s !== 'converted' && s !== 'rejected') out.push(cancel);
  return detail ? <>{out}</> : <ActsMenu>{out}</ActsMenu>;
}
