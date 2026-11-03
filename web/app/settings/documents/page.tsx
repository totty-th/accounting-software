import { requirePage } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { getDb } from '@/lib/db';
import { SForm } from '@/components/SForm';
import { saveDocSettings } from '@/lib/actions';

export const dynamic = 'force-dynamic';
const REM: [string, string][] = [['QT', 'ใบเสนอราคา'], ['INV', 'ใบแจ้งหนี้/ใบกำกับภาษี'], ['CA', 'ขายเงินสด'], ['BL', 'ใบวางบิล'], ['CN', 'ใบลดหนี้'], ['DN', 'ใบเพิ่มหนี้'], ['PO', 'ใบสั่งซื้อ'], ['RI', 'ใบรับสินค้า'], ['EXP', 'ค่าใช้จ่าย']];
export default async function Documents() {
  const user = await requirePage('settings.company');
  const s = (await (await getDb()).q<any>('select * from doc_settings'))[0];
  const lv = (name: string, label: string, hint: string) => (
    <label>{label} <select name={name} defaultValue={s[name]}><option value="line">ระดับรายการ (แต่ละบรรทัด)</option><option value="footer">ระดับท้ายเอกสาร (ใช้ค่าเดียวทุกบรรทัด)</option></select><span className="sub"> {hint}</span></label>);
  return (
    <>
      <div className="top"><div><h1>ตั้งค่าเอกสาร</h1><p className="sub">ค่าตั้งต้นของฟอร์มสร้างเอกสารขาย (ใบเสนอราคา/ใบแจ้งหนี้) · แก้ในแต่ละเอกสารได้อีกครั้ง</p></div></div>
      <SForm action={saveDocSettings} canWrite={can(user.role, 'settings.company')} style={{ maxWidth: 720 }}>
        <h3>ฟังก์ชันเอกสาร</h3>
        <label>ราคาสินค้า <select name="price_mode" defaultValue={s.price_mode}><option value="exclusive">ราคาไม่รวมภาษี</option><option value="inclusive">ราคารวมภาษี</option></select></label>
        <h4>เอกสารขาย</h4>
        {lv('vat_level', 'ภาษีมูลค่าเพิ่ม', '')}
        {lv('discount_level', 'ส่วนลด', '(ท้ายเอกสาร = เปอร์เซ็นต์เดียวกันทุกบรรทัด)')}
        {lv('wht_level', 'หัก ณ ที่จ่าย', '')}
        <h4>เอกสารซื้อ/ค่าใช้จ่าย</h4>
        {lv('pur_vat_level', 'ภาษีมูลค่าเพิ่ม', '')}
        {lv('pur_discount_level', 'ส่วนลด', '(ท้ายเอกสาร = เปอร์เซ็นต์เดียวกันทุกบรรทัด)')}
        {lv('pur_wht_level', 'หัก ณ ที่จ่าย', '')}
        <label><input type="checkbox" name="show_warehouse" value="1" defaultChecked={s.show_warehouse} /> แสดงคลังสินค้าในฟอร์มเอกสาร</label>
        <label><input type="checkbox" name="multi_currency" value="1" defaultChecked={s.multi_currency} /> เปิดใช้งานหลายสกุลเงิน (ตั้งค่าที่เมนูสกุลเงิน)</label>
        <h3>หมายเหตุเอกสาร (ข้อความตั้งต้น)</h3>
        {REM.map(([k, l]) => <label key={k}>{l} <textarea name={'remark_' + k} rows={2} maxLength={1000} defaultValue={s.remarks?.[k] ?? ''} /></label>)}
      </SForm>
    </>
  );
}
