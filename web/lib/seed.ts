import type { Db } from './db';

// ผังบัญชีตัวอย่างสำหรับทดลองเท่านั้น (รหัสที่ติดป้าย "ชั่วคราว" ต้องยืนยันกับผังบัญชีจริง)
const COA: [string, string, string][] = [
  ['11112', 'เงินสดและเงินฝากธนาคาร', 'asset'], ['11311', 'ลูกหนี้การค้า', 'asset'], ['11319', 'ใบเสร็จรอเรียกเก็บ', 'asset'],
  ['11500', 'สินค้าคงเหลือ (ชั่วคราว)', 'asset'], ['11921', 'เงินมัดจำจ่าย', 'asset'], ['11922', 'เงินประกัน', 'asset'],
  ['12612', 'คอมพิวเตอร์และอุปกรณ์', 'asset'], ['17111', 'ภาษีซื้อ ภ.พ.30', 'asset'], ['17113', 'ภาษีซื้อยังไม่ถึงกำหนด', 'asset'],
  ['17114', 'ภาษีมูลค่าเพิ่มรอขอคืน', 'asset'], ['17120', 'ภาษีถูกหัก ณ ที่จ่าย', 'asset'],
  ['21311', 'เจ้าหนี้การค้า', 'liability'], ['21398', 'เงินทดรอง', 'liability'], ['21399', 'เจ้าหนี้อื่นๆ', 'liability'],
  ['21921', 'เงินมัดจำรับ', 'liability'], ['27111', 'ภาษีขาย', 'liability'], ['27124', 'ภาษีหัก ณ ที่จ่าย ภ.ง.ด.53', 'liability'],
  ['27140', 'เจ้าหนี้สรรพากร', 'liability'], ['31000', 'ทุนเรือนหุ้น', 'equity'], ['32000', 'กำไรสะสม (ชั่วคราว)', 'equity'],
  ['41110', 'รายได้จากการขายสินค้า', 'revenue'], ['41210', 'รายได้จากการให้บริการ', 'revenue'], ['41400', 'รับคืนและส่วนลดจ่าย', 'revenue'],
  ['49910', 'เงินบริจาค/สนับสนุน', 'revenue'], ['49990', 'รายได้อื่น', 'revenue'],
  ['51100', 'ต้นทุนขาย (ชั่วคราว)', 'expense'], ['53101', 'ค่าบริการ', 'expense'], ['53102', 'ค่าเช่า', 'expense'],
  ['53103', 'ค่าขนส่ง', 'expense'], ['53104', 'ค่าการตลาด', 'expense'],
];

export async function seed(db: Db) {
  for (const [c, n, t] of COA) await db.q('insert into accounts(code,name,type) values ($1,$2,$3)', [c, n, t]);
  const d = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
  const c1 = (await db.q(`insert into contacts(business_name,tax_id) values ('บริษัท สยามก่อสร้าง จำกัด','0105500000001') returning id`))[0].id;
  await db.q(`insert into contacts(business_name,tax_id) values ('ห้างหุ้นส่วน ไทยเหล็กกล้า','0103500000002')`);
  const v1 = (await db.q(`insert into contacts(business_name,tax_id) values ('บริษัท เหล็กไทย ซัพพลาย จำกัด','0105500000003') returning id`))[0].id;
  const p1 = (await db.q(`insert into products(code,name,kind,base_unit,sale_price,purchase_price) values ('MESH-01','ตะแกรงเหล็กสำเร็จรูป 1x2 ม.','goods_stock','แผ่น',1000,600) returning id`))[0].id;
  await db.q(`insert into products(code,name,kind,base_unit,sale_price) values ('SVC-01','ค่าติดตั้ง','service','งาน',2000)`);
  await db.q(`select create_goods_receipt($1::date,$2,$3::jsonb)`, [d, v1, JSON.stringify([{ product_id: p1, qty: 50, unit_price: 600 }])]);
  await db.q(`select create_sales_doc('INV',$1::date,$2,$3::jsonb)`, [d, c1, JSON.stringify([
    { description: 'ตะแกรงเหล็กสำเร็จรูป 1x2 ม.', product_id: p1, qty: 10, unit_price: 1000 },
    { description: 'ค่าติดตั้ง', kind: 'service', qty: 1, unit_price: 2000 }])]);
  await db.q(`select create_sales_doc('QT',$1::date,$2,$3::jsonb)`, [d, c1, JSON.stringify([
    { description: 'ตะแกรงยืดสั่งทำ', kind: 'goods', qty: 20, unit_price: 1500 }])]);
  await db.q(`select create_expense($1::date,$2,$3::jsonb)`, [d, v1, JSON.stringify([
    { description: 'ค่าเช่าโกดัง', account: '53102', qty: 1, unit_price: 15000, wht_rate: 5 }])]);
}
