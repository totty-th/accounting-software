// คัดลอกฟอนต์ Sarabun จาก @fontsource เข้า assets/fonts (ใช้ตอน build บน Vercel เพื่อไม่ต้องอัปโหลดไฟล์ฟอนต์ซ้ำ)
import fs from 'node:fs';
const src = 'node_modules/@fontsource/sarabun/files', dst = 'assets/fonts';
fs.mkdirSync(dst, { recursive: true });
for (const s of ['latin', 'thai']) for (const w of [400, 700]) {
  const f = `sarabun-${s}-${w}-normal.woff`;
  if (!fs.existsSync(`${dst}/${f}`)) fs.copyFileSync(`${src}/${f}`, `${dst}/${f}`);
}
