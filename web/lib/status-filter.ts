/** ตัวกรองสถานะแบบเลือกได้หลายค่า (checkbox ซ้ำชื่อ `st`) → รายการค่าที่อยู่ในรายการที่อนุญาต · ว่าง = ทั้งหมด */
export function parseStatuses(raw: string | string[] | undefined, allowed: string[]): string[] {
  return ([] as string[]).concat(raw ?? []).filter(s => allowed.includes(s));
}
