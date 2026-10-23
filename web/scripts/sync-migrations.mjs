// สร้างสำเนา migration ไว้ใน web/migrations สำหรับ deploy (ตัดบรรทัดคอมเมนต์เต็มบรรทัดและบรรทัดว่างออกเพื่อให้เล็ก)
import fs from 'node:fs';
fs.rmSync('migrations', { recursive: true, force: true });
fs.mkdirSync('migrations');
for (const f of fs.readdirSync('../supabase/migrations').sort()) {
  const s = fs.readFileSync(`../supabase/migrations/${f}`, 'utf8');
  fs.writeFileSync(`migrations/${f}`, s.split('\n').filter(l => l.trim() && !/^\s*--/.test(l)).join('\n') + '\n');
}
