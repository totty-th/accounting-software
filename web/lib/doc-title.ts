// ชื่อเอกสารและสีประจำชนิด (ใช้ทั้งหน้าจอ พิมพ์ และ PDF)
export const DOC_TITLE: Record<string, { title: string; color: string; rgb: [number, number, number] }> = {
  QT: { title: 'ใบเสนอราคา', color: '#e8870e', rgb: [0.91, 0.53, 0.06] },
  INV: { title: 'ใบแจ้งหนี้/ใบกำกับภาษี', color: '#1f6fb5', rgb: [0.12, 0.44, 0.71] },
  CA: { title: 'ใบกำกับภาษี/ใบเสร็จรับเงิน (ขายสด)', color: '#0f8f7a', rgb: [0.06, 0.56, 0.48] },
  BL: { title: 'ใบวางบิล', color: '#5b8a1f', rgb: [0.36, 0.54, 0.12] },
  CN: { title: 'ใบลดหนี้/ใบกำกับภาษี', color: '#c0392b', rgb: [0.75, 0.22, 0.17] },
  DN: { title: 'ใบเพิ่มหนี้/ใบกำกับภาษี', color: '#7b4fb5', rgb: [0.48, 0.31, 0.71] },
};
