insert into accounts(code, name, type)
select '51111.01', 'ซื้อสินค้า', 'expense'
 where not exists (select 1 from accounts where code = '51111.01');
update system_accounts set account_code = '51111.01',
       note = 'บัญชีที่ลงตอนรับสินค้า (RI) — ซื้อสินค้า ตาม FA (สินค้าคงเหลือแบบสิ้นงวด)'
 where key = 'inventory';
