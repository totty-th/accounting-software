import { getDb } from './db';
/** หมายเหตุตั้งต้นของชนิดเอกสาร (ตั้งที่ ตั้งค่า → ตั้งค่าเอกสาร) ใช้เติมในเอกสารใหม่ */
export async function defaultRemark(type: string): Promise<string> {
  const r = (await (await getDb()).q<{ v: string | null }>(`select remarks->>$1 as v from doc_settings`, [type]))[0];
  return r?.v ?? '';
}
