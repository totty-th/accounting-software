import { ActsMenu } from '@/components/ActsMenu';
import { ActionButton } from '@/components/ActionButton';
import * as A from '@/lib/actions';
import { can, type Role } from '@/lib/permissions';

// ปุ่มต่อยอด/เปลี่ยนสถานะของเอกสารขาย (ใช้ทั้งหน้ารายการและหน้ารายละเอียด)
export function SalesActions({ d, role, detail = false }: { d: any; role: Role; detail?: boolean }) {
  const W = can(role, 'sales.write') || can(role, 'sales.own');   // sales.own: หน้ารายการ/รายละเอียดแสดงเฉพาะเอกสารของตัวเอง
  const b = (label: string, fn: () => Promise<any>, v: '' | 'ghost' | 'danger' = 'ghost', confirmText?: string) =>
    <ActionButton key={label} label={label} variant={v} confirmText={confirmText} action={fn} />;
  const cancel = b('ยกเลิก', A.cancelSalesDoc.bind(null, d.id), 'danger', 'c');
  const s = d.status as string;
  const out: React.ReactNode[] = [];
  const held = !!d.cbl;   // M65: อยู่ในใบวางบิลรวมที่ใช้งานอยู่ → ล็อกสถานะ/ยกเลิก/ลด-เพิ่มหนี้ (FA)
  if (can(role, 'receipts.write') && d.doc_type === 'INV' && (s === 'awaiting_payment' || s === 'split_paid')) out.push(b('สร้างใบเสร็จ', A.createReceipt.bind(null, d.id), ''));
  if (W && d.doc_type === 'INV' && !held && (s === 'awaiting_payment' || s === 'split_paid') && d.doc_no && !d.is_deposit)
    out.push(<a key="cbl" className="btn sm ghost" href={`/sales/combined?inv=${encodeURIComponent(d.doc_no)}`}>สร้างใบวางบิลรวม</a>);
  if (W && d.doc_type === 'INV' && !held && s === 'awaiting_payment' && d.doc_no) {
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
  if (W && d.doc_type === 'CA' && s === 'pending_collect' && !detail && d.doc_no) out.push(<a key="cc" className="btn sm" href={`/sales/${d.doc_no}`}>เก็บเงิน…</a>);   // เลือกช่องทางรับเงินที่หน้ารายละเอียด
  if (W && d.doc_type === 'CA' && s === 'collected') out.push(b('รีเซ็ต', A.resetCash.bind(null, d.id)));
  if (W && d.doc_type === 'BL' && d.is_deposit && s === 'billed') out.push(b('สร้างใบแจ้งหนี้มัดจำ (ลงบัญชี)', A.convertDepositBl.bind(null, d.id), ''));
  if (W && (d.doc_type === 'CN' || d.doc_type === 'DN') && s === 'cancelled') out.push(b('รีเซ็ต', A.restoreSalesDoc.bind(null, d.id), '', 'c'));
  // M64 สถานะแบบ FA: ใบแจ้งหนี้ รอดำเนินการ ⇄ รอเก็บเงิน · ใบวางบิล รอวางบิล/วางบิลแล้ว/เปิดบิลแล้ว · ยกเลิก → รีเซ็ต
  const sv = (d.status_view ?? s) as string;
  if (W && d.doc_type === 'INV' && !held && sv === 'inv_pending') out.push(b('วางบิลแล้ว', A.invoiceSetBilled.bind(null, d.id, true), ''));
  if (W && d.doc_type === 'INV' && !held && s === 'awaiting_payment' && sv === 'awaiting_payment') out.push(b('รีเซ็ต', A.invoiceSetBilled.bind(null, d.id, false)));
  if (W && d.doc_type === 'BL' && d.is_combined) {   // M65 ใบวางบิลรวม
    if (s === 'pending_billing' && d.doc_no) out.push(<a key="cbe" className="btn sm ghost" href={`/sales/combined?id=${encodeURIComponent(d.doc_no)}`}>แก้ไข</a>);
    if (s === 'pending_billing') out.push(b('วางบิลแล้ว', A.billingNoteSetStatus.bind(null, d.id, 'billed'), ''));
    if (s === 'pending_billing' || s === 'billed') out.push(b('เปิดบิลแล้ว', A.billingNoteSetStatus.bind(null, d.id, 'invoice_opened')));
    if (can(role, 'receipts.write') && ['pending_billing', 'billed', 'invoice_opened'].includes(s))
      out.push(b('สร้างใบเสร็จรวม', A.combinedBillingReceipt.bind(null, d.id), 'ghost', 'สร้างใบเสร็จรวมจากใบวางบิลนี้? (ใบวางบิลจะเป็น "เปิดใบเสร็จแล้ว")'));
    if (s === 'billed' || s === 'invoice_opened') out.push(b('รีเซ็ต', A.billingNoteSetStatus.bind(null, d.id, 'pending_billing')));
  }
  if (W && d.doc_type === 'BL' && !d.is_deposit && !d.is_combined) {
    if (s === 'pending_billing') out.push(b('วางบิลแล้ว', A.billingNoteSetStatus.bind(null, d.id, 'billed'), ''));
    if (s === 'pending_billing' || s === 'billed') {
      out.push(b('เปิดบิลแล้ว', A.billingNoteSetStatus.bind(null, d.id, 'invoice_opened')));
      if (!Number(d.deposit_net)) out.push(b('สร้างใบแจ้งหนี้', A.billingNoteToInvoice.bind(null, d.id), 'ghost', 'สร้างใบแจ้งหนี้จากใบวางบิลนี้? (ลงบัญชีลูกหนี้ทันที)'));
    }
    if (s === 'billed' || s === 'invoice_opened') out.push(b('รีเซ็ต', A.billingNoteSetStatus.bind(null, d.id, 'pending_billing')));
  }
  if (W && ['INV', 'CA', 'BL'].includes(d.doc_type) && s === 'cancelled' && !d.is_deposit && !Number(d.deposit_net))
    out.push(b('รีเซ็ต', A.resetCancelledSalesDoc.bind(null, d.id), '', 'รีเซ็ตเอกสารที่ยกเลิก? (ลงบัญชีใหม่และตัดสต็อกใหม่)'));
  if (W && d.doc_type === 'CA' && s === 'collected' && detail) out.push(b('แก้ไขข้อมูลการเก็บเงิน', A.resetCash.bind(null, d.id), 'ghost', 'แก้ไขข้อมูลการเก็บเงิน? ระบบจะกลับรายการเก็บเงินเดิม แล้วให้บันทึกการเก็บเงินใหม่'));
  if ((W || (can(role, 'quote.own') && d.doc_type === 'QT')) && s !== 'cancelled' && s !== 'converted' && s !== 'rejected' && !held
    && !(d.doc_type === 'BL' && s === 'receipt_opened')) out.push(cancel);
  return detail ? <>{out}</> : <ActsMenu float>{out}</ActsMenu>;
}
