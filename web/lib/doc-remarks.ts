import { getDb } from './db';
/** หมายเหตุตั้งต้นของชนิดเอกสาร (ตั้งที่ ตั้งค่า → ตั้งค่าเอกสาร) ใช้เติมในเอกสารใหม่ */
export async function defaultRemark(type: string): Promise<string> {
  const r = (await (await getDb()).q<{ v: string | null }>(`select remarks->>$1 as v from doc_settings`, [type]))[0];
  return r?.v ?? '';
}

export type PurLevels = { vat: 'line' | 'footer'; discount: 'line' | 'footer'; wht: 'line' | 'footer' };
/** ระดับ VAT/ส่วนลด/หัก ณ ที่จ่าย ของเอกสารซื้อ/ค่าใช้จ่าย (แยกจากเอกสารขาย) */
export async function purchaseLevels(): Promise<PurLevels> {
  const r = (await (await getDb()).q<any>(`select pur_vat_level v, pur_discount_level d, pur_wht_level w from doc_settings`))[0];
  return { vat: r?.v ?? 'line', discount: r?.d ?? 'line', wht: r?.w ?? 'line' };
}
