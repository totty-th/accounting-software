// อ่านจำนวนเงินเป็นตัวอักษรไทย (ใช้ได้ทั้งฝั่งเซิร์ฟเวอร์และเบราว์เซอร์)
const NUM = ['ศูนย์', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
const POS = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน'];
function readInt(n: number): string {
  if (n === 0) return '';
  if (n >= 1_000_000) {
    const r = n % 1_000_000;
    return readInt(Math.floor(n / 1_000_000)) + 'ล้าน' + (r === 1 ? 'เอ็ด' : readInt(r));
  }
  const s = String(n); let out = '';
  for (let i = 0; i < s.length; i++) {
    const d = +s[i], p = s.length - i - 1;
    if (d === 0) continue;
    if (p === 1 && d === 1) out += 'สิบ';
    else if (p === 1 && d === 2) out += 'ยี่สิบ';
    else if (p === 0 && d === 1 && s.length > 1) out += 'เอ็ด';
    else out += NUM[d] + POS[p];
  }
  return out;
}
export function bahtText(amount: number): string {
  const satangTotal = Math.round(amount * 100);
  const baht = Math.floor(satangTotal / 100), satang = satangTotal % 100;
  if (satangTotal === 0) return 'ศูนย์บาทถ้วน';
  const b = baht > 0 ? readInt(baht) + 'บาท' : '';
  return satang === 0 ? b + 'ถ้วน' : b + readInt(satang) + 'สตางค์';
}
