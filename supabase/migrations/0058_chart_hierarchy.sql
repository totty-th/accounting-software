-- M33 บริหารผังบัญชีแบบ FA (REA 1-11-2026): ต้นไม้ผังบัญชี (บัญชีคุม/บัญชีย่อย) · ชื่อ-คำอธิบายภาษาอังกฤษ · ลบบัญชีที่ไม่มีรายการ
-- บัญชีคุม = หัวกลุ่มในต้นไม้ ลงรายการบัญชีไม่ได้ · บัญชีย่อย = บัญชีที่ลงรายการได้ (ใบของต้นไม้) · ตำแหน่งในต้นไม้กำหนดจากกลุ่มที่เลือกตอนสร้าง ไม่ต้องขึ้นต้นรหัสตามกลุ่ม
alter table accounts
  add column parent_id uuid references accounts(id),
  add column is_control boolean not null default false,
  add column name_en text,
  add column description_en text;
create index accounts_parent_idx on accounts(parent_id);

-- รหัสแม่ตามแบบแผนของผังมาตรฐาน: 11122.01 → 11122 · 11111 → 11110 → 11100 → 11000 → 10000 (ปรับตัวเลขหลักท้ายที่ไม่ใช่ศูนย์เป็น 0) · ใช้เฉพาะตอนจัดวางบัญชีที่สร้างโดยไม่ระบุกลุ่ม
create function account_parent_code(c text) returns text language plpgsql immutable as $$
declare b text := regexp_replace(c, '[^0-9.].*$', ''); i int;
begin
  if position('.' in b) > 0 then return split_part(b, '.', 1); end if;
  i := length(rtrim(b, '0'));
  if i <= 1 then return null; end if;
  return overlay(b placing '0' from i for 1);
end $$;

create function account_find_parent(c text) returns uuid language plpgsql stable as $$
declare p text := account_parent_code(c); v uuid;
begin
  while p is not null loop
    select id into v from accounts where code = p and is_control;
    if found then return v; end if;
    p := account_parent_code(p);
  end loop;
  return null;
end $$;

-- บัญชีคุมของผังมาตรฐาน (หัวกลุ่ม) · รหัสที่มีบัญชีใช้งานอยู่แล้วคงเป็นบัญชีย่อยตามเดิม
insert into accounts(code, name, type, is_control, name_en)
select v.code, v.name, account_type_of(v.code), true, v.en
  from (values
  ('10000', 'สินทรัพย์', 'Assets'),
  ('11000', 'สินทรัพย์หมุนเวียน', 'Current Assets'),
  ('11100', 'เงินสดและรายการเทียบเท่าเงินสด', 'Cash and Cash Equivalents'),
  ('11110', 'เงินสด', 'Cash'),
  ('11120', 'เงินฝากธนาคาร', 'Bank Accounts'),
  ('11121', 'เงินฝากกระแสรายวัน', 'Current Accounts'),
  ('11122', 'เงินฝากออมทรัพย์', 'Saving Accounts'),
  ('11123', 'เงินฝากประจำ', 'Fixed Deposit Accounts'),
  ('11149', 'เงินสดย่อย', 'Petty Cash'),
  ('11189', 'เครื่องบันทึกเงินสด', 'Cash register/Point of Sale'),
  ('11200', 'เงินลงทุนชั่วคราว', 'Short-term Investments'),
  ('11210', 'เงินลงทุนเพื่อค้า', 'Trading Investments'),
  ('11220', 'เงินลงทุนชั่วคราว-เงินฝาก', 'Short-term Investments - Bank'),
  ('11223', 'เงินลงทุนชั่วคราว-เงินฝากประจำ', 'Fixed Deposits'),
  ('11300', 'ลูกหนี้การค้าและลูกหนี้หมุนเวียนอื่น', 'Trade and Other Current Receivables'),
  ('11310', 'ลูกหนี้การค้า', 'Accounts Receivables'),
  ('11320', 'ตั๋วเงินรับ/เช็ครับล่วงหน้า', 'Notes Receivable/Advanced cheques'),
  ('11379', 'ลูกหนี้ตัวแทนรับชำระเงิน', 'Receivables from Payment Service Provider'),
  ('11390', 'ลูกหนี้อื่น', 'Other receivables'),
  ('11400', 'เงินให้กู้ยืมระยะสั้น', 'Short-term loan'),
  ('11450', 'เงินให้กู้ยืมระยะสั้น - บุคคลหรือกิจการที่เกี่ยวข้องกัน', 'Short-term Loan - Related parties'),
  ('11500', 'สินค้าคงเหลือ', 'Allowance and Adjustments - Inventories'),
  ('11510', 'สินค้าสำเร็จรูป', 'Finished Goods'),
  ('11520', 'วัตถุดิบคงเหลือ', 'Raw Materials'),
  ('11530', 'งานระหว่างทำ/สินค้าระหว่างผลิต', 'Work In Process'),
  ('11590', 'สินค้าอื่นๆ', 'Other Inventories'),
  ('11900', 'สินทรัพย์หมุนเวียนอื่น', 'Other Current Non-Financial Assets'),
  ('11910', 'ค่าใช้จ่ายจ่ายล่วงหน้า', 'Prepaid Expenses'),
  ('11911', 'เบี้ยประกันจ่ายล่วงหน้า', 'Prepaid Insurance Premiums'),
  ('11920', 'เงินจ่ายล่วงหน้า', 'Prepayments'),
  ('11970', 'สินทรัพย์ชีวภาพหมุนเวียน', 'Current Biological Assets'),
  ('11990', 'กลุ่มสินทรัพย์ที่ถือไว้เพื่อขายและการดำเนินงานที่ยกเลิก', 'Assets Classified as Held for Sale and Discontinued Operation'),
  ('12000', 'สินทรัพย์ไม่หมุนเวียน', 'Non-current assets'),
  ('12200', 'เงินลงทุนระยะยาว', 'Investments in associate and joint venture'),
  ('12300', 'ลูกหนี้การค้าและลูกหนี้ไม่หมุนเวียนอื่น', 'Trade and Other Non-Current Receivables'),
  ('12310', 'ลูกหนี้การค้าไม่หมุนเวียน', 'Non-current Accounts Receivable'),
  ('12390', 'ลูกหนี้ไม่หมุนเวียนอื่น', 'Other Non-Current Receivables'),
  ('12400', 'เงินให้กู้ยืมระยะยาว', 'Long-term loans'),
  ('12450', 'เงินให้กู้ยืมระยะยาว - บุคคลหรือกิจการที่เกี่ยวข้องกัน', 'Long-term Loan - Related Parties'),
  ('12500', 'อสังหาริมทรัพย์เพื่อการลงทุน', 'Investment Property'),
  ('12600', 'ที่ดิน อาคาร และอุปกรณ์', 'Property, Plant and Equipments'),
  ('12615', 'สินทรัพย์ตามสัญญาเช่า', 'Leased Assets'),
  ('12616', 'เครื่องจักรและอุปกรณ์', 'Machinery & Equipment'),
  ('12617', 'อาคาร', 'Buildings '),
  ('12618', 'งานระหว่างก่อสร้าง', 'Assets Under Construction'),
  ('12619', 'ที่ดิน', 'Land'),
  ('12700', 'สินทรัพย์ไม่มีตัวตน', 'Intangible Assets'),
  ('12900', 'สินทรัพย์อื่นๆ', 'Other Assets'),
  ('12910', 'ค่าใช้จ่ายรอตัดจ่ายระยะยาว', 'Deferred Expenses '),
  ('12920', 'เงินจ่ายล่วงหน้าไม่หมุนเวียน', 'Non-Current Prepayments'),
  ('12970', 'สินทรัพย์ชีวภาพไม่หมุนเวียน', 'Non-current biological assets'),
  ('17000', 'สินทรัพย์ทางภาษี', 'Tax Assets'),
  ('17100', 'สินทรัพย์ทางภาษีหมุนเวียน', 'Current Tax Assets'),
  ('17110', 'ภาษีมูลค่าเพิ่ม -สินทรัพย์', 'Value Added Tax - Assets'),
  ('18000', 'ค่าเสื่อมราคา ด้อยค่า และการตีราคา', 'Depreciation, Impairment and Revaluations'),
  ('18200', 'ค่าเผื่อการด้อยค่า/การตีราคา เงินลงทุน', 'Allowance for Impairment/Revaluation - Investments'),
  ('18220', 'ค่าเผื่อการด้อยค่า - เงินลงทุน', 'Allowance for Impairment - Investments'),
  ('18230', 'มูลค่ายุติธรรม - เงินลงทุน', 'Fair Value Revaluation - Investments'),
  ('18300', 'ค่าเผื่อหนี้สงสัยจะสูญ ลูกหนี้การค้าและลูกหนี้อื่น', 'Allowance for Doubtful Accounts'),
  ('18310', 'ค่าเผื่อการด้อยค่า ลูกหนี้การค้าและลูกหนี้อื่น', 'Allowance for Doubtful Accounts'),
  ('18400', 'ค่าเผื่อการด้อยค่า/การตีราคา เงินให้กู้ยืม', 'Allowance for Impairment/Revaluation - Loans'),
  ('18420', 'ค่าเผื่อการด้อยค่า - เงินให้กู้ยืม', 'Allowance for Impairment - Loan'),
  ('18500', 'ค่าเผื่อการด้อยค่า/การตีราคา สินค้าคงเหลือ', 'Allowance for Impairment/Revaluation - Inventories'),
  ('18520', 'ค่าเผื่อสินค้าล้าสมัย/เสื่อมสภาพ', 'Allowance for obsolete inventories'),
  ('18530', 'ค่าเผื่อมูลค่าสินค้าคงเหลือลดลง', 'Allowance for diminution in value of inventories'),
  ('18600', 'ค่าเสื่อมราคา/การด้อยค่า/การตีราคา ที่ดินอาคารอุปกรณ์', 'Allowance for Depreciation/Impairment/Revaluation - PPE'),
  ('18610', 'ค่าเสื่อมราคาสะสม', 'Accumulated Depreciation'),
  ('18615', 'ค่าเสื่อมราคาสะสม สินทรัพย์ตามสัญญาเช่า', 'Accumulated Depreciation - Leased Assets'),
  ('18616', 'ค่าเสื่อมราคาสะสม เครื่องจักรและอุปกรณ์', 'Accumulated Depreciation - Machinery and Equipment'),
  ('18617', 'ค่าเสื่อมราคาสะสม อาคาร', 'Accumulated Depreciation - Buildings'),
  ('18620', 'ค่าเผื่อการด้อยค่า - ที่ดิน อาคาร อุปกรณ์', 'Allowance for Impairment - PPE'),
  ('18700', 'ค่าเสื่อมราคา/การด้อยค่า สินทรัพย์ไม่มีตัวตน', 'Allowance for Depreciation/Impairment - Intangible assets'),
  ('18710', 'ค่าตัดจำหน่ายสะสม', 'Accumulated Amortization'),
  ('18720', 'ค่าเผื่อการด้อยค่า - สินทรัพย์ไม่มีตัวตน', 'Allowance for Impairment - Intangible Assets'),
  ('18970', 'ค่าเสื่อมราคา/การด้อยค่า/การตีราคา อสังหาริมทรัพย์เพื่อการลงทุน', 'Allowance for Depreciation/Impairment/Revaluation - Investment Property'),
  ('18990', 'ค่าเสื่อมราคา/การด้อยค่า/การตีราคา สินทรัพย์ชีวภาพ', 'Allowance for Depreciation/Impairment/Revaluation - Biological Assets'),
  ('19000', 'บัญชีจากระบบ', 'System accounts'),
  ('19100', 'บัญชีจากระบบและรายการไม่สมดุล', 'Rounding and system suspense'),
  ('19198', 'บัญชีพัก - Unposted', 'Unposted Transactions'),
  ('19199', 'บัญชีพักระบบงาน', 'Suspense accounts'),
  ('19200', 'บัญชีพักจากสถานะเอกสารและเหตุการณ์', 'Document and event suspense'),
  ('20000', 'หนี้สิน', 'Liabilities'),
  ('21000', 'หนี้สินหมุนเวียน', 'Current liabilities'),
  ('21100', 'เงินเบิกเกินบัญชี/เงินกู้ยืมธนาคารระยะสั้น', 'Bank Overdraft/Short-term Bank Borrowings'),
  ('21300', 'เจ้าหนี้การค้าและเจ้าหนี้หมุนเวียนอื่น', 'Trade and Other Current Payables'),
  ('21310', 'เจ้าหนี้การค้า', 'Trade Payables'),
  ('21320', 'ตั๋วเงิน/เช็คจ่ายล่วงหน้า', 'Notes & Cheques Payable'),
  ('21329', 'เช็คจ่าย', 'Cheque Payments'),
  ('21379', 'บัตรเครดิตจ่าย', 'Credit Card Payables'),
  ('21390', 'เจ้าหนี้อื่น', 'Other Payables'),
  ('21400', 'เงินกู้ยืมระยะสั้น', 'Short-term Borrowings'),
  ('21500', 'หนี้สินที่ถึงกำหนดชำระภายใน 1 ปี', 'Current Portion of Long-term Liabilities'),
  ('21580', 'หนี้สินสัญญาเช่าการเงินที่ถึงกำหนดชำระภายใน 1 ปี', 'Current Portion of Finance Lease'),
  ('21800', 'ประมาณการหนี้สินระยะสั้น', 'Current Provisions and Estimates'),
  ('21900', 'หนี้สินหมุนเวียนอื่น', 'Other Current Liabilities'),
  ('21910', 'ค่าใช้จ่ายค้างจ่าย', 'Accrued Expenses'),
  ('21911', 'ค่าสาธารณูปโภคค้างจ่าย', 'Accrued utility expenses'),
  ('21920', 'เงินรับล่วงหน้า/รายได้รับล่วงหน้า', 'Unearned Revenues'),
  ('21950', 'ค่าใช้จ่ายพนักงานค้างจ่าย', 'Accrued Employee Expenses'),
  ('21951', 'เงินเดือนและค่าจ้างค้างจ่าย', 'Accrued Salaries & Wages'),
  ('21952', 'เงินประกันสังคม/กองทุนสำรองฯรอนำส่ง', 'Accrued Social Security/Provident Fund'),
  ('21952Z', 'เงินกองทุนรอนำส่ง', 'Accrued Funds'),
  ('21990', 'หนี้สินที่เกี่ยวกับกลุ่มสินทรัพย์ที่ถือไว้เพื่อขายและการดำเนินงานที่ยกเลิก', 'Liabilities Related to Assets Classified as Held for Sale and discontinuted operation'),
  ('22000', 'หนี้สินไม่หมุนเวียน', 'Non-current Liabilities'),
  ('22300', 'เจ้าหนี้การค้าและเจ้าหนี้ไม่หมุนเวียนอื่น', 'Trade and Other Non-current Payables'),
  ('22310', 'เจ้าหนี้การค้าไม่หมุนเวียน', 'Non-Current Accounts Payable'),
  ('22390', 'เจ้าหนี้อื่นไม่หมุนเวียน', 'Non-current other payables'),
  ('22400', 'เงินกู้ยืมระยะยาว', 'Long-term Borrowings'),
  ('22500', 'หนี้สินทางการเงินไม่หมุนเวียนอื่น', 'Other Non-Current Financial Liabilities'),
  ('22580', 'หนี้สินสัญญาเช่าทางการเงินระยะยาว', 'Long-term Finance Lease'),
  ('22800', 'ประมาณการหนี้สินระยะยาว', 'Non-current provisions and estimates'),
  ('22900', 'หนี้สินอื่นๆ', 'Other Non-current Liabilities'),
  ('27000', 'หนี้สินทางภาษี', 'Tax Liablities'),
  ('27100', 'หนี้สินทางภาษีหมุนเวียน', 'Current Tax Liabilities'),
  ('27110', 'ภาษีมูลค่าเพิ่ม - หนี้สิน', 'Value Added Tax - Liabilities'),
  ('27120', 'ภาษีหัก ณ ที่จ่ายค้างจ่าย', 'Withholding Tax Payable'),
  ('27130', 'ภาษีค้างจ่าย', 'Current Income tax payable'),
  ('30000', 'ส่วนของผู้ถือหุ้น/ส่วนของผู้เป็นหุ้นส่วน', 'Shareholders'' Equity'),
  ('31000', 'ทุนที่ออกและชำระแล้ว', 'Share Capital'),
  ('31100', 'ทุนจดทะเบียน', 'Authorized Share Capital'),
  ('31200', 'ทุนที่ชำระแล้ว', 'Issued Capital'),
  ('32000', 'ส่วนเกิน (ต่ำกว่า) มูลค่าหุ้น', 'Share Premium (Discount)'),
  ('33000', 'สำรองอื่น', 'Other reserves'),
  ('34000', 'กำไร (ขาดทุน) สะสม', 'Retained Earnings'),
  ('34100', 'กำไร (ขาดทุน) สะสม - จัดสรรแล้ว', 'Retained Earnings - Appropriated '),
  ('39000', 'องค์ประกอบอื่นของส่วนของผู้ถือหุ้น', 'Other Equity Interest'),
  ('39100', 'กำไรขาดทุนเบ็ดเสร็จอื่น', 'Other Comprehensive Income'),
  ('40000', 'รายได้', 'Revenues'),
  ('41000', 'รายได้สุทธิ', 'Net Sales'),
  ('41100', 'รายได้จากการขายสินค้า', 'Revenue from Sale of Goods'),
  ('41200', 'รายได้จากการให้บริการ', 'Revenue from Rendering of Services'),
  ('47000', 'รายได้จากการดำเนินงานที่ยกเลิก', 'Revenues from Discontinued operations'),
  ('49000', 'รายได้อื่น', 'Other income'),
  ('49030', 'รายได้ค่าสิทธิ', 'Royalty Income'),
  ('49040', 'รายได้จากการให้เช่า', 'Leased Income'),
  ('49900', 'รายได้อื่น', 'Other Income'),
  ('50000', 'ค่าใช้จ่าย', 'Expenses'),
  ('51000', 'ต้นทุนขายสุทธิ', 'Cost of Sales - Net'),
  ('51100', 'ต้นทุนขายสินค้าเพื่อขาย', 'Cost of Goods Sold - Net'),
  ('51110', 'ส่วนเปลี่ยนแปลงของสินค้าสำเร็จรูป', 'Increase/Decrease in Finished Good'),
  ('51111', 'ซื้อสินค้า', 'Purchase - Finished Goods'),
  ('51120', 'วัตถุดิบและวัสดุสิ้นเปลืองใช้ไป', 'Raw Materials and Consumable Used'),
  ('51121', 'ซื้อวัตถุดิบและวัสดุ', 'Purchase - Raw Materials'),
  ('51129', 'ส่วนเปลี่ยนแปลงวัตถุดิบและวัสดุ (ต้น-ปลาย)', 'Changes in Raw Materials (Beginning - Ending)'),
  ('51130', 'ต้นทุนการผลิต/ต้นทุนคิดเข้างาน', 'Increase/Decrease in Work in Progress'),
  ('51131', 'ต้นทุนการผลิต - คน', 'Production costs - People/Labor'),
  ('51132', 'ต้นทุนการผลิต - พลังงาน', 'Production costs - Utilities/Power'),
  ('51133', 'ต้นทุนการผลิต - แพคเกจ', 'Production costs - Packaging'),
  ('51134', 'ต้นทุนการผลิต - ค่าสึกหรอและค่าเสื่อมราคา', 'Production costs - Depreciation/Amortization'),
  ('51135', 'ต้นทุนการผลิต - ค่าสิทธิ์/ลิขสิทธิ์', 'Production costs - Copy'),
  ('51139', 'ส่วนเปลี่ยนแปลงของระหว่างทำ (ต้น-ปลาย)', 'Changes in work in process (Beginning-Ending)'),
  ('51200', 'ต้นทุนการให้บริการ', 'Cost of services'),
  ('52000', 'ค่าใช้จ่ายในการขาย', 'Selling expenses'),
  ('52010', 'ค่าพาหนะ/ค่าใช้จ่ายเดินทาง/ที่พัก ', 'Vehicles Travelling and Accommodations '),
  ('52030', 'ค่าขนส่งและลอจิสติกส์', 'Logistics Expenses'),
  ('52060', 'ค่าส่งเสริมการขายและอีเวนท์', 'Sales promotion and events'),
  ('53000', 'ค่าใช้จ่ายในการบริหาร', 'Administrative Expenses'),
  ('53010', 'ค่าใช้จ่ายเกี่ยวกับพนักงาน', 'Employee Expenses'),
  ('53011', 'เงินเดือนและค่าจ้างแรงงาน', 'Salaries and wages'),
  ('53012', 'เงินประกันสังคม/กองทุนสำรองฯ', 'Social security expenses'),
  ('53012Z', 'เงินสะสมกองทุน', 'Funds Contribution'),
  ('53013', 'เงินสวัสดิการพนักงาน', 'Employee Benefits & Welfare'),
  ('53020', 'ค่าใช้จ่ายด้านโฆษณาและการตลาด', 'Advertising and marketing expenses'),
  ('53030', 'ค่าสาธารณูปโภคและค่าใช้จ่ายสำนักงาน', 'Office and utilities expenses'),
  ('53031', 'ค่าสาธาณูปโภค', 'Utility expenses'),
  ('53032', 'ค่าใช้จ่ายสำนักงาน', 'Office Expenses'),
  ('53040', 'ค่าเบี้ยประกัน', 'Insurance Expenses'),
  ('53080', 'ค่าแห่งกู๊ดวิลล์/ลิขสิทธิ์/สิทธิอย่างอื่น', 'Goodwill and Copyrights'),
  ('53100', 'ค่าบริการด้านวิชาชีพ', 'Professional services expenses'),
  ('53110', 'ค่าบริการทั่วไป', 'Services expenses'),
  ('53210', 'ค่าธรรมเนียมต่างๆ', 'Fee expenses'),
  ('53700', 'ค่าภาษี', 'Tax Expenses'),
  ('54000', 'ต้นทุนทางการเงิน', 'Finance Costs'),
  ('54200', 'ดอกเบี้ยจากสัญญาเช่าการเงิน', 'Finance lease interest expenses'),
  ('57000', 'ค่าใช้จ่ายจากการดำเนินงานที่ยกเลิก', 'Expenses from discontinued operations'),
  ('58000', 'ค่าเสื่อมราคา ด้อยค่า และการตีราคา', 'Depreciation, Impairment and Revaluations'),
  ('58200', 'การด้อยค่า/การตีราคา เงินลงทุน', 'Allowance and Adjustments - Investments'),
  ('58220', 'ขาดทุนจากการด้อยค่า - เงินลงทุน', 'Impairment loss - Investments'),
  ('58230', 'มูลค่ายุติธรรม - เงินลงทุน', 'Gain/loss on fair value revaluation - Investments'),
  ('58300', 'การด้อยค่า ลูกหนี้การค้าและลูกหนี้อื่น', 'Allowance and Adjustments - Accounts receivable and other receivables'),
  ('58310', 'หนี้สงสัยจะสูญ ลูกหนี้การค้าและลูกหนี้อื่น', 'Doubtful and bad debt expenses'),
  ('58400', 'การด้อยค่า/การตีราคา เงินให้กู้ยืม', 'Allowance and Adjustments - Loans'),
  ('58420', 'ขาดทุนจากการด้อยค่า - เงินให้กู้ยืม', 'Impairment loss - Loan'),
  ('58500', 'การด้อยค่า/การตีราคา สินค้าคงเหลือ', 'Allowance and Adjustments - Inventories'),
  ('58520', 'ขาดทุนจากสินค้าเสื่อมสภาพ/ล้าสมัย', 'Loss on obsolete inventories'),
  ('58530', 'ขาดทุนจากการตีราคาสินค้าคงเหลือลดลง', 'Loss on devaluation of inventories'),
  ('58600', 'ค่าเสื่อมราคา/การด้อยค่า/การตีราคา ที่ดินอาคารอุปกรณ์', 'Allowance and Adjustments - PPE'),
  ('58610', 'ค่าเสื่อมราคา', 'Depreciation Expenses'),
  ('58615', 'ค่าเสื่อมราคา สินทรัพย์ตามสัญญาเช่า', 'Depreciation - Leased Assets'),
  ('58616', 'ค่าเสื่อมราคา เครื่องจักรและอุปกรณ์', 'Depreciation - Machinery & Equipments'),
  ('58617', 'ค่าเสื่อมราคา อาคาร', 'Depreciation - Buildings'),
  ('58620', 'ขาดทุนจากการด้อยค่า - ที่ดิน อาคาร อุปกรณ์', 'Impairment loss - PPE'),
  ('58630', 'มูลค่ายุติธรรม - ที่ดิน อาคาร อุปกรณ์', 'Revaluation - PPE'),
  ('58700', 'ค่าเสื่อมราคา/การด้อยค่า/การตีราคา สินทรัพย์ไม่มีตัวตน', 'Allowance and Adjustments - Intangible Assets'),
  ('58710', 'ค่าตัดจำหน่าย', 'Amortization expenses - Intangible Assets'),
  ('58720', 'ขาดทุนจากการด้อยค่า - สินทรัพย์ไม่มีตัวตน', 'Impairment loss - Intangible Assets'),
  ('58970', 'ค่าเสื่อมราคา/การด้อยค่า/การตีราคา อสังหาริมทรัพย์เพื่อการลงทุน', 'Allowance and Adjustments - Investment Property'),
  ('58990', 'ค่าเสื่อมราคา/การด้อยค่า/การตีราคา สินทรัพย์ชีวภาพ', 'Allowance and Adjustments - Biological Assets'),
  ('59000', 'ค่าใช้จ่ายอื่น', 'Other expenses'),
  ('59900', 'ค่าใช้จ่ายอื่นและเบ็ดเตล็ด', 'Other and miscellaneous expenses'),
  ('59990', 'รายจ่ายอื่นๆ', 'Other expenses')
  ) as v(code, name, en)
on conflict (code) do nothing;

update accounts a set parent_id = account_find_parent(a.code);

-- ลงรายการบัญชีในบัญชีคุมไม่ได้
create function reject_control_posting() returns trigger language plpgsql as $$
begin
  if exists (select 1 from accounts where id = new.account_id and is_control) then
    raise exception 'ลงรายการในบัญชีคุมไม่ได้ กรุณาเลือกบัญชีย่อย';
  end if;
  return new;
end $$;
-- บัญชีที่ระบบสร้างเอง (ธนาคาร เงินสดย่อย บัตรเครดิต เช็ค สินทรัพย์ถาวร) จัดเข้ากลุ่มตามรูปแบบรหัสอัตโนมัติ
create function accounts_default_parent() returns trigger language plpgsql as $$
begin
  if new.parent_id is null then new.parent_id := account_find_parent(new.code); end if;
  return new;
end $$;
create trigger accounts_default_parent before insert on accounts for each row execute function accounts_default_parent();

create trigger journal_lines_no_control before insert on journal_lines for each row execute function reject_control_posting();

drop function create_account(text, text, text);
-- สร้างบัญชี: ระบุกลุ่ม (บัญชีคุมแม่) → ชนิดบัญชีตามกลุ่ม · ไม่ระบุ = หากลุ่มจากรูปแบบรหัส · สร้างเป็นบัญชีคุมได้ (หัวกลุ่ม ลงรายการไม่ได้)
create function create_account(p_code text, p_name text, p_description text default null, p_parent text default null, p_control boolean default false, p_name_en text default null, p_description_en text default null)
returns uuid language plpgsql as $$
declare v_id uuid; v_code text := btrim(coalesce(p_code, '')); v_parent uuid; v_type text;
begin
  if v_code = '' and coalesce(btrim(p_name), '') = '' then raise exception 'ไม่สามารถบันทึกได้ เนื่องจากข้อมูลไม่ถูกต้อง/ไม่ครบถ้วน: กรุณากรอกรหัสบัญชี และกรุณากรอกชื่อบัญชี'; end if;
  if v_code = '' then raise exception 'ไม่สามารถบันทึกได้ เนื่องจากข้อมูลไม่ถูกต้อง/ไม่ครบถ้วน: กรุณากรอกรหัสบัญชี'; end if;
  if coalesce(btrim(p_name), '') = '' then raise exception 'ไม่สามารถบันทึกได้ เนื่องจากข้อมูลไม่ถูกต้อง/ไม่ครบถ้วน: กรุณากรอกชื่อบัญชี'; end if;
  if v_code !~ '^[0-9]{5}(\.[0-9]{1,3})?$' then raise exception 'รหัสบัญชีต้องเป็นเลข 5 หลัก เช่น 53012 หรือ 53012.01'; end if;
  if exists (select 1 from accounts where code = v_code) then raise exception 'เลขรหัสผังบัญชีต้องไม่ซ้ำกัน'; end if;
  if p_parent is not null then
    select id, type into v_parent, v_type from accounts where code = p_parent and is_control;
    if v_parent is null then raise exception 'ไม่พบกลุ่มบัญชี (บัญชีคุม) %', p_parent; end if;
  else
    v_type := account_type_of(v_code);
    if v_type is null then raise exception 'รหัสบัญชีต้องขึ้นต้นด้วย 1-5 หรือเลือกกลุ่มบัญชี'; end if;
    v_parent := account_find_parent(v_code);
  end if;
  insert into accounts(code, name, type, description, parent_id, is_control, name_en, description_en)
  values (v_code, btrim(p_name), v_type, nullif(btrim(p_description), ''), v_parent, coalesce(p_control, false), nullif(btrim(p_name_en), ''), nullif(btrim(p_description_en), ''))
  returning id into v_id;
  return v_id;
end $$;

drop function update_account(uuid, text, text, boolean);
-- แก้ชื่อ/คำอธิบาย (ไทย-อังกฤษ)/เปิด-ปิดใช้งาน · รหัส ชนิด และสถานะบัญชีคุมแก้ไม่ได้ · ปิดใช้งานได้เมื่อยอดคงเหลือเป็นศูนย์ และไม่ใช่บัญชีที่ระบบอ้างอิง
create function update_account(p_id uuid, p_name text, p_description text, p_active boolean, p_name_en text default null, p_description_en text default null) returns void language plpgsql as $$
declare a accounts; v_bal numeric;
begin
  select * into a from accounts where id = p_id;
  if not found then raise exception 'ไม่พบบัญชี'; end if;
  if coalesce(btrim(p_name), '') = '' then raise exception 'ไม่สามารถบันทึกได้ เนื่องจากข้อมูลไม่ถูกต้อง/ไม่ครบถ้วน: กรุณากรอกชื่อบัญชี'; end if;
  if a.is_active and not p_active then
    select coalesce(sum(debit - credit), 0) into v_bal from journal_lines where account_id = p_id;
    if v_bal <> 0 then raise exception 'บัญชีนี้ยังมียอดคงเหลือ ปิดใช้งานไม่ได้'; end if;
    if exists (select 1 from system_accounts where account_code = a.code) then raise exception 'บัญชีนี้ระบบใช้ลงบัญชีอัตโนมัติ ปิดใช้งานไม่ได้'; end if;
  end if;
  update accounts set name = btrim(p_name), description = nullif(btrim(p_description), ''), is_active = p_active,
         name_en = nullif(btrim(p_name_en), ''), description_en = nullif(btrim(p_description_en), '') where id = p_id;
end $$;

-- ลบบัญชี: ได้เฉพาะบัญชีที่ไม่มีรายการบัญชี ไม่มีบัญชีลูก และไม่ใช่บัญชีที่ระบบอ้างอิง/ผูกกับบัญชีธนาคาร เงินสดย่อย บัตรเครดิต เช็ค
create function delete_account(p_id uuid) returns void language plpgsql as $$
declare a accounts;
begin
  select * into a from accounts where id = p_id;
  if not found then raise exception 'ไม่พบบัญชี'; end if;
  if exists (select 1 from journal_lines where account_id = p_id) then raise exception 'ลบไม่ได้ บัญชีนี้มีรายการบัญชีแล้ว'; end if;
  if exists (select 1 from accounts where parent_id = p_id) then raise exception 'ลบไม่ได้ บัญชีนี้มีบัญชีลูกอยู่'; end if;
  if exists (select 1 from expense_lines where account_code = a.code) then raise exception 'ลบไม่ได้ บัญชีนี้ถูกใช้ในเอกสารค่าใช้จ่าย'; end if;
  if exists (select 1 from system_accounts where account_code = a.code) then raise exception 'ลบไม่ได้ บัญชีนี้ระบบใช้ลงบัญชีอัตโนมัติ'; end if;
  if exists (select 1 from bank_accounts where account_id = p_id) or exists (select 1 from petty_funds where account_id = p_id)
     or exists (select 1 from credit_cards where account_id = p_id) or exists (select 1 from cheque_accounts where account_id = p_id) then
    raise exception 'ลบไม่ได้ บัญชีนี้ผูกกับบัญชีธนาคาร/เงินสดย่อย/บัตรเครดิต/เช็ค';
  end if;
  delete from accounts where id = p_id;
end $$;
