-- หมวดสินทรัพย์ตั้งต้นของโรงงานผลิตตะแกรง (ข้อมูลของกิจการ) · อายุใช้งานเป็นค่าสมมติ รอเจ้าของ/นักบัญชียืนยัน (docs/rea-assets.md §8)
select create_account('12621', 'เครื่องจักรและแม่พิมพ์ผลิต', null, '12616');
select create_account('12622', 'อาคารโรงงาน', null, '12617');
select create_account('12623', 'ที่ดินโรงงาน', null, '12619');
select create_account('18621', 'ค่าเสื่อมราคาสะสม-เครื่องจักรและแม่พิมพ์', null, '18616');
select create_account('18622', 'ค่าเสื่อมราคาสะสม-อาคารโรงงาน', null, '18617');
select create_account('58621', 'ค่าเสื่อมราคา-เครื่องจักรและแม่พิมพ์', null, '58616');
select create_account('58622', 'ค่าเสื่อมราคา-อาคารโรงงาน', null, '58617');
select save_asset_category(null, '{"name":"เครื่องจักรผลิต (เครื่องปั๊ม/ตัด/พับ)","name_en":"Production machinery","life_years":10,"asset_account":"12621","dep_account":"58621","accum_account":"18621"}');
select save_asset_category(null, '{"name":"แม่พิมพ์และเครื่องมือ","name_en":"Dies and tools","life_years":5,"asset_account":"12621","dep_account":"58621","accum_account":"18621"}');
select save_asset_category(null, '{"name":"อาคารโรงงาน","name_en":"Factory building","life_years":20,"asset_account":"12622","dep_account":"58622","accum_account":"18622"}');
select save_asset_category(null, '{"name":"ที่ดิน","name_en":"Land","depreciate":false,"asset_account":"12623"}');
