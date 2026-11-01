export const VAT_STATUS: [string, string][] = [['wait', 'รอใบกำกับภาษี'], ['received', 'รับใบกำกับภาษีแล้ว'], ['waived', 'ไม่ใช้สิทธิขอคืน']];
/** ตัวกรองสถานะหลายค่าของหน้า "จัดการเอกสารภาษีซื้อ" (แบบ FA) พร้อมสีจุดหน้าเลขที่เอกสาร */
export const VAT_KEYS: [string, string, string][] = [
  ['wait', 'รอใบกำกับภาษี', '#9aa0a6'], ['pp36', 'รอยื่น ภ.พ.36', '#e2445c'], ['rdwait', 'รอใบเสร็จสรรพากร', '#fdab3d'],
  ['received', 'รับใบกำกับภาษี', '#0086c0'], ['waived', 'ไม่ใช้สิทธิขอคืน', '#ff642e'], ['filed', 'ยื่นแบบแล้ว', '#00c875']];
export const VAT_CLAIM: [string, string][] = [['m0', 'ภายในเดือนนี้'], ['m1', 'ภายในเดือนหน้า'], ['m6', 'ภายใน 6 เดือน'], ['exp', 'หมดอายุแล้ว']];
/** สถานะรวมของเอกสาร (ใช้กรอง/แสดงสี) */
export function vatKey(r: { st: string; filed: boolean; stage: string }): string {
  if (r.filed) return 'filed';
  if (r.st === 'waived') return 'waived';
  if (r.st === 'wait') return 'wait';
  if (r.stage === 'pp36' || r.stage === 'f36') return 'pp36';
  if (r.stage === 'rdwait') return 'rdwait';
  return 'received';
}
/** กำหนดใช้สิทธิภาษีซื้อ = วันสุดท้ายของเดือนที่ 6 นับจากเดือนของวันที่เอกสาร (มาตรา 82/3: ภายใน 6 เดือนนับแต่เดือนภาษีที่ใบกำกับภาษีถึงกำหนดเครดิต)
 *  ขอบเขตวันที่แน่ชัดของ FA ยังไม่ทดสอบ — รอเจ้าของยืนยัน */
export function claimDeadline(docDate: string): string {
  const y = Number(docDate.slice(0, 4)), m = Number(docDate.slice(5, 7)) + 6;
  const d = new Date(Date.UTC(y, m, 0)); return d.toISOString().slice(0, 10);
}
export function claimBucket(docDate: string, todayIso: string): string {
  const dl = claimDeadline(docDate);
  if (dl < todayIso) return 'exp';
  const mEnd = (k: number) => new Date(Date.UTC(Number(todayIso.slice(0, 4)), Number(todayIso.slice(5, 7)) + k, 0)).toISOString().slice(0, 10);
  if (dl <= mEnd(0)) return 'm0'; if (dl <= mEnd(1)) return 'm1'; return 'm6';
}
