import { ActionButton } from './ActionButton';
import * as A from '@/lib/actions';

/** แท็บ "ข้อมูลใบกำกับภาษีที่ได้รับ" ของ EXP / RI (ไม่ลงบัญชี ใช้เป็นฐานรายงานภาษีซื้อ) */
export function TaxInvoiceBox({ type, id, inv, canWrite, vendor }: { type: 'EXP' | 'RI'; id: string; inv?: any; canWrite: boolean; vendor?: { name?: string; tax_id?: string } }) {
  return (
    <details><summary className="btn sm ghost">{inv ? `ใบกำกับ ${inv.invoice_no}` : 'ใบกำกับภาษี'}</summary>
      <form action={A.savePurchaseTaxInvoice}><fieldset disabled={!canWrite} style={{ display: 'grid', gap: 6, margin: '8px 0', border: 0, padding: 0, minWidth: 220 }}>
        <input type="hidden" name="doc_type" value={type} /><input type="hidden" name="doc_id" value={id} />
        <label>เลขที่ใบกำกับภาษี <input name="invoice_no" required defaultValue={inv?.invoice_no ?? ''} /></label>
        <label>วันที่ใบกำกับ <input name="invoice_date" type="date" defaultValue={inv?.invoice_date ? String(inv.invoice_date).slice(0, 10) : ''} /></label>
        <label>แบบที่ยื่น <select name="vat_form" defaultValue={inv?.vat_form ?? 'PP30'}><option value="PP30">ภ.พ.30</option><option value="PP36">ภ.พ.36</option></select></label>
        <label>ชื่อผู้จำหน่าย <input name="vendor_name" defaultValue={inv?.vendor_name ?? vendor?.name ?? ''} /></label>
        <label>เลขประจำตัวผู้เสียภาษี <input name="vendor_tax_id" pattern="[0-9]{13}" defaultValue={inv?.vendor_tax_id ?? vendor?.tax_id ?? ''} /></label>
        <label>สาขา <input name="branch" defaultValue={inv?.branch ?? ''} placeholder="สำนักงานใหญ่ / 00001" /></label>
        <label>มูลค่าสินค้า/บริการ <input name="base_amount" type="number" step="0.01" min="0" defaultValue={inv ? +inv.base_amount : ''} placeholder="ว่าง = ตามเอกสาร" /></label>
        <label>ภาษีมูลค่าเพิ่ม <input name="vat_amount" type="number" step="0.01" min="0" defaultValue={inv ? +inv.vat_amount : ''} placeholder="ว่าง = ตามเอกสาร" /></label>
        {canWrite && <button className="btn sm">บันทึก</button>}
      </fieldset></form>
      {canWrite && inv && <ActionButton label="ล้างข้อมูลใบกำกับ" variant="danger" confirmText="c" action={A.clearPurchaseTaxInvoice.bind(null, type, id)} />}
    </details>
  );
}
