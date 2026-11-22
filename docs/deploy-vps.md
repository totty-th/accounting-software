# ระบบบัญชีบน VPS (Coolify) — ตั้งแต่ 22-11-2026

ย้ายจาก Vercel + Supabase มาที่ VPS Hostinger (72.60.235.135, Ubuntu 24.04) ที่มี Coolify 4.7 อยู่แล้ว · ไม่แตะแอปเดิมบนเครื่อง (sales / customer / hermes)

## โครงสร้างใน Coolify (project "Accounting")
| ส่วน | รายละเอียด |
|---|---|
| เว็บ `accounting-web` | https://acc.tmplns.tech · build จาก github.com/totty-th/accounting-software (main) · base directory `/web` · `web/Dockerfile` · พอร์ต 3000 |
| ฐาน `accounting-db` | PostgreSQL 17 (alpine) ไม่เปิดพอร์ตสู่ภายนอก · database/user `accounting` · collation ICU `en-US` (เรียงภาษาไทยเหมือน Supabase) |
| Env ของเว็บ | `DATABASE_URL` (ชี้ accounting-db ผ่าน network ภายใน coolify) · `SESSION_SECRET` (ตั้งใหม่ตอนย้าย) · `NEXT_PUBLIC_BASE_URL=https://acc.tmplns.tech` (build-time ด้วย) |
| Backup | Coolify scheduled backup ทุกวัน 02:00 เวลาไทย (`0 19 * * *` UTC) เก็บ 30 ชุดในเครื่อง — **ยังไม่มีสำเนานอกเครื่อง** (ควรเพิ่ม S3 เช่น Cloudflare R2 ใน Coolify → Storages แล้วเปิด save_s3) |
| ไฟล์ตั้งค่าบนเครื่อง | `/root/acc/db.env` (uuid + รหัสฐาน, สิทธิ์ root เท่านั้น) · `/root/acc/dumps/` สำเนาฐาน Supabase ก่อนย้าย |

## Deploy
- **อัตโนมัติ:** push ขึ้น `main` แล้วภายใน ~2 นาที cron บน VPS (`/etc/cron.d/accounting-autodeploy` → `/root/acc/autodeploy.sh`) เห็น commit ใหม่และสั่ง Coolify deploy · ประวัติอยู่ที่ `/root/acc/autodeploy.log` · ใช้ API token `claude-migration` ใน `/root/.coolify-token` (ถ้าลบ token นี้ deploy อัตโนมัติจะหยุด)
  - ปิดชั่วคราว: `rm /etc/cron.d/accounting-autodeploy` · deploy เอง: กด Deploy ใน Coolify หรือ `POST /api/v1/deploy {"uuid":"<APP_UUID>"}`
- ตอนคอนเทนเนอร์เปิด `web/scripts/migrate.mjs` รันก่อน `next start` เสมอ:
  - ตาราง `app_schema_migrations` เก็บชื่อไฟล์ใน `web/migrations` ที่รันแล้ว (ตอนย้ายบันทึก 0001–0102 เป็น baseline)
  - ไฟล์ใหม่จะถูก apply ทีละไฟล์ในธุรกรรมของตัวเอง ถ้าล้ม คอนเทนเนอร์ไม่เปิด (Coolify คงเวอร์ชันเก่าไว้) ดู log ที่หน้า Deployments
- **เพิ่ม migration:** เขียนไฟล์ใน `supabase/migrations/` → `cd web && npm run sync-migrations` → commit ทั้งสองโฟลเดอร์ → deploy (ไม่ต้อง apply ด้วยมือแล้ว)

## วิธีย้ายที่ใช้ (ไว้ทำซ้ำ/ตรวจสอบ)
1. `pg_dump -Fc -n public --no-owner --no-acl` จาก Supabase (session pooler ด้วย role อ่านอย่างเดียวชั่วคราว ลบทิ้งแล้ว)
2. `drop schema public cascade` บน accounting-db → `pg_restore --no-owner --no-acl --exit-on-error --single-transaction`
3. ตรวจ fingerprint ต้นทาง/ปลายทาง: จำนวนแถว + md5 ของข้อมูลทุกแถว ทุกตาราง (82 ตาราง), md5 ของฟังก์ชัน (335), จำนวนทริกเกอร์ (34), งบทดลองทุกบัญชี — ผลรอบจริง **ตรง 100% (111 รายการ)** · สมุดรายวัน 306 บรรทัด เดบิต = เครดิต = 533,010.19
4. ทดสอบกู้คืน: dump ฐานใหม่ → restore เข้าฐานชั่วคราว → ยอดตรง → ลบฐานชั่วคราว

## ที่เก่า (เก็บไว้ถึง ~22-12-2026 เผื่อย้อนกลับ)
- Vercel ตั้ง env `MOVED_TO=https://acc.tmplns.tech` → `web/middleware.ts` ส่งทุกหน้าไปที่อยู่ใหม่ (กันคนบันทึกลงฐานเก่า)
- Supabase โปรเจกต์ `accounting` (jvcckncdsmjsshvuiqbu) ข้อมูล ณ เวลาย้าย ไม่มีการเขียนเพิ่มหลังย้าย

## ย้อนกลับไป Vercel + Supabase (ถ้าจำเป็น)
1. ถ้ามีการบันทึกบน VPS แล้ว: dump accounting-db (schema public) แล้ว restore กลับเข้า Supabase (ต้องตรวจ fingerprint แบบเดียวกัน)
2. ลบ env `MOVED_TO` บน Vercel แล้ว redeploy
3. ปิดแอป accounting-web ใน Coolify
