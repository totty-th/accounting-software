// ชื่อเอกสารและสีประจำชนิด (ใช้ทั้งหน้าจอ พิมพ์ และ PDF)
// สีหลักของเอกสารทุกชนิด = น้ำเงิน TMP (#1F2D5C ตามเอกสารเดิมของบริษัท) · เจ้าของระบบขอเปลี่ยนจากส้ม 25-11-2026
// ใช้ทั้ง PDF และหน้าจอ — พรีวิว/ลิงก์ลูกค้าแสดง PDF จริง จึงตรงกันเสมอ
export const DOC_HEX = '#1f2d5c';
export const DOC_COLOR: [number, number, number] = [0.122, 0.176, 0.361];
export const DOC_TITLE: Record<string, { title: string; color: string; rgb: [number, number, number] }> = {
  QT: { title: 'ใบเสนอราคา', color: DOC_HEX, rgb: DOC_COLOR },
  INV: { title: 'ใบแจ้งหนี้/ใบกำกับภาษี', color: DOC_HEX, rgb: DOC_COLOR },
  CA: { title: 'ใบกำกับภาษี/ใบเสร็จรับเงิน (ขายสด)', color: DOC_HEX, rgb: DOC_COLOR },
  BL: { title: 'ใบวางบิล', color: DOC_HEX, rgb: DOC_COLOR },
  CN: { title: 'ใบลดหนี้/ใบกำกับภาษี', color: DOC_HEX, rgb: DOC_COLOR },
  DN: { title: 'ใบเพิ่มหนี้/ใบกำกับภาษี', color: DOC_HEX, rgb: DOC_COLOR },
};
