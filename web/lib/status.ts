// ป้ายสถานะแบบบอร์ด: ข้อความ + สี (monday-style)
export type Tone = 'green' | 'orange' | 'blue' | 'purple' | 'red' | 'grey' | 'teal';
export const STATUS: Record<string, [string, Tone]> = {
  pending_approval: ['รออนุมัติ', 'orange'], approved: ['อนุมัติแล้ว', 'green'], converted: ['ดำเนินการแล้ว', 'teal'],
  deposit_paid: ['มัดจำแล้ว', 'purple'], partial: ['แบ่งจ่าย', 'purple'], awaiting_payment: ['รอเก็บเงิน', 'orange'], receipt_opened: ['เปิดใบเสร็จแล้ว', 'blue'],
  split_paid: ['แบ่งจ่าย', 'purple'], pending_collect: ['รอเก็บเงิน', 'orange'], collected: ['เก็บเงินแล้ว', 'green'],
  active: ['ใช้งาน', 'green'], billed: ['วางบิลแล้ว', 'blue'], invoice_opened: ['เปิดบิลแล้ว', 'blue'], cancelled: ['ยกเลิก', 'grey'],
  pending: ['รอดำเนินการ', 'orange'], paid: ['ชำระแล้ว', 'green'], unpaid: ['รออนุมัติ', 'orange'], rejected: ['ไม่อนุมัติ', 'red'],
  received: ['รับสินค้าแล้ว', 'green'], filed: ['ยื่นแล้ว', 'blue'], deleted: ['ลบแล้ว', 'grey'],
};
export const DOC_TYPE: Record<string, string> = {
  QT: 'ใบเสนอราคา', INV: 'ใบแจ้งหนี้', CA: 'ขายสด', BL: 'ใบวางบิล', CN: 'ใบลดหนี้', DN: 'ใบเพิ่มหนี้',
};
export const RECEIPT_KIND: Record<string, string> = { invoice: 'ใบเสร็จ', combined: 'ใบเสร็จรวม', other: 'รับเงินอื่นๆ' };
export const OTHER_TYPES: Record<string, string> = {
  guarantee_return: 'คืนเงินประกัน', advance: 'เงินทดรอง/รับคืนค่าใช้จ่าย', customer_deposit: 'เงินมัดจำรับ',
  vendor_deposit_return: 'รับคืนเงินมัดจำจากผู้ขาย', donation: 'เงินบริจาค/สนับสนุน', other_income: 'รายได้อื่น',
};
