-- M68 ล็อกอินจริงรายคน (เจ้าของระบบ 18-11-2026: "ใช้อีเมลล็อกอิน ครั้งแรกผมตั้งรหัสให้")
-- รหัสผ่านเก็บเป็น scrypt hash (คำนวณฝั่งเซิร์ฟเวอร์แอป) · ไม่ใช้ Supabase Auth
-- must_change_password: ผู้ดูแลตั้ง/รีเซ็ตรหัส → ผู้ใช้ต้องเปลี่ยนเองตอนเข้าครั้งแรก
-- session_version: เพิ่มเมื่อเปลี่ยนรหัส/รีเซ็ต/ปิดใช้งาน → คุกกี้เดิมใช้ไม่ได้ทันที
-- failed_logins / locked_until: ผิด 5 ครั้งล็อก 5 นาที (เก็บในฐานข้อมูล ใช้ได้ทุก instance)
-- setup_token_*: ลิงก์ตั้งบัญชีครั้งแรกแบบใช้ครั้งเดียว (เก็บเฉพาะ sha256 ของโทเคน)
alter table app_users add column password_hash text, add column must_change_password boolean not null default false,
  add column session_version int not null default 0, add column failed_logins int not null default 0, add column locked_until timestamptz,
  add column setup_token_hash text, add column setup_token_expires timestamptz, add column password_set_at timestamptz;
-- ผู้ดูแลแก้อีเมลได้ แต่ห้ามซ้ำ (ไม่สนตัวพิมพ์) · อีเมลเก็บเป็นตัวพิมพ์เล็กเสมอ
update app_users set email = lower(btrim(email)) where email is not null and email <> lower(btrim(email));
create unique index app_users_email_uq on app_users (lower(email)) where email is not null;
