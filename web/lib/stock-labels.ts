export const PURPOSE: [string, string][] = [['storage', 'จัดเก็บสินค้า'], ['raw_materials', 'จัดเก็บวัตถุดิบ'], ['branch', 'เป็นสาขาของร้านค้า'], ['headquarters', 'เป็นสำนักงานใหญ่'],
  ['consignment', 'ฝากขาย'], ['ecommerce', 'ขายออนไลน์'], ['distribution_center', 'ศูนย์กระจายสินค้า'], ['seasonal', 'ตามฤดูกาล'], ['other', 'อื่น ๆ']];
export const ADJ_OUT: string[] = ['ตัดวัตถุดิบใช้ไป', 'ปรับจำนวนสินค้าจากการนับสินค้า', 'สินค้าสูญหาย', 'ทำลายสินค้า', 'สินค้าชำรุด/เสื่อมสภาพ', 'อื่น ๆ'];
export const ADJ_IN: string[] = ['ปรับจำนวนสินค้าจากการนับสินค้า', 'ได้รับสินค้าเพิ่ม', 'อื่น ๆ'];
export const KIND_LABEL: Record<string, string> = { service: 'บริการ', goods_nostock: 'สินค้าไม่นับสต็อก', goods_stock: 'สินค้านับสต็อก' };
