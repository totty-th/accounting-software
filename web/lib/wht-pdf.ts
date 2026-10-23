import fs from 'node:fs';
import path from 'node:path';
import { PDFDocument, PDFFont, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

// ข้อมูลที่ wht_cert_data() คืนมา
export interface CertData {
  cert_no: string; book_no: string | null; run_no: string | null; seq_in_form: number | null;
  form_choice: string | null; // '1'..'7' ตามช่องติ๊กในแบบ (4 = ภ.ง.ด.3, 7 = ภ.ง.ด.53)
  payer: Party; payee: Party;
  income_category: '1' | '2' | '3' | '4a' | '5' | '6'; income_note: string | null;
  pay_date: string; base_amount: number | string; wht_amount: number | string;
  payer_condition: 'withhold' | 'forever' | 'once' | 'other'; payer_condition_note: string | null;
  fund_gpf: number | string; fund_sso: number | string; fund_pvd: number | string;
  issue_date: string; missing: string[];
}
interface Party { name: string | null; address: string | null; tax_id: string | null; person_kind: string | null }

const ASSETS = () => { const a = path.join(process.cwd(), 'assets'); return fs.existsSync(a) ? a : path.join(process.cwd(), 'web/assets'); };

// ---------- ข้อความไทย ----------
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
const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const thDate = (iso: string) => { const [y, m, d] = iso.slice(0, 10).split('-'); return { d: String(+d), m: String(+m), y: String(+y + 543) }; };
const isThai = (c: string) => /[฀-๿]/.test(c);

// ---------- ตำแหน่งบนแบบ (หน่วย pt, จุดเริ่มซ้ายล่าง A4 595x842; อ่านจากช่องกรอกของแบบทางการ) ----------
const ROW: Record<string, { y: number; d?: [number, number] }> = {
  '1': { y: 536 }, '2': { y: 522 }, '3': { y: 507 }, '4a': { y: 493 }, '5': { y: 219 }, '6': { y: 202 },
};
const COL = { date: [327, 403], payBahtRight: 473, paySatang: 477, taxBahtRight: 545, taxSatang: 548 };
const BOX_CENTERS: number[] = (() => { // 13 หลักแบ่ง 1-4-5-2-1 ตามช่องของแบบ
  const g = (x0: number, n: number, pitch: number) => Array.from({ length: n }, (_, i) => x0 + pitch / 2 + i * pitch);
  return [...g(375, 1, 12), ...g(392.4, 4, 11.9), ...g(447.5, 5, 12), ...g(513.7, 2, 11.9), ...g(544.6, 1, 12)];
})();
const CHECK_RECTS: Record<string, [number, number]> = { // ช่องแบบ (1)-(7) ตามมุมซ้ายล่างของช่องติ๊ก
  '1': [209, 603], '2': [288, 603], '3': [395, 602], '4': [471, 602], '5': [209, 584], '6': [287, 584], '7': [395, 584],
};
const COND_RECTS: Record<string, [number, number]> = { withhold: [82, 119], forever: [177, 120], once: [282, 120], other: [394, 119] };

export async function buildCertPdf(d: CertData): Promise<Uint8Array> {
  const dir = ASSETS();
  const pdf = await PDFDocument.load(fs.readFileSync(path.join(dir, 'wht-50tawi-blank.pdf')));
  pdf.registerFontkit(fontkit);
  const f = (n: string) => pdf.embedFont(fs.readFileSync(path.join(dir, 'fonts', n)), { subset: true });
  const fonts = { th: await f('sarabun-thai-400-normal.woff'), la: await f('sarabun-latin-400-normal.woff'),
                  thB: await f('sarabun-thai-700-normal.woff'), laB: await f('sarabun-latin-700-normal.woff') };
  const page = pdf.getPage(0);

  // วาดข้อความผสมไทย/ละติน โดยแยกชุดตัวอักษรตามช่วงยูนิโค้ด
  const runs = (s: string) => { const out: [string, boolean][] = []; for (const ch of s) {
    const t = isThai(ch) || ch === '฿'; const last = out[out.length - 1];
    if (last && last[1] === t) last[0] += ch; else out.push([ch, t]); } return out; };
  const width = (s: string, size: number) => runs(s).reduce((w, [t, th]) => w + (th ? fonts.th : fonts.la).widthOfTextAtSize(t, size), 0);
  const text = (s: string, x: number, y: number, size = 10, opt: { right?: boolean; center?: boolean; maxW?: number } = {}) => {
    if (!s) return;
    let sz = size; if (opt.maxW) while (sz > 5 && width(s, sz) > opt.maxW) sz -= 0.25;
    let cx = opt.right ? x - width(s, sz) : opt.center ? x - width(s, sz) / 2 : x;
    for (const [t, th] of runs(s)) {
      const fnt: PDFFont = th ? fonts.th : fonts.la;
      page.drawText(t, { x: cx, y, size: sz, font: fnt, color: rgb(0, 0, 0) });
      cx += fnt.widthOfTextAtSize(t, sz);
    }
  };
  const tick = (x: number, y: number) => { // เครื่องหมายถูกแบบเส้นเวกเตอร์ (ไม่พึ่งฟอนต์)
    const o = { thickness: 1.4, color: rgb(0, 0, 0) };
    page.drawLine({ start: { x: x + 2, y: y + 6 }, end: { x: x + 5, y: y + 2.5 }, ...o });
    page.drawLine({ start: { x: x + 5, y: y + 2.5 }, end: { x: x + 11, y: y + 11 }, ...o });
  };
  const digits = (s: string, y: number) => {
    const ds = s.replace(/\D/g, ''); if (ds.length !== 13) return;
    [...ds].forEach((c, i) => text(c, BOX_CENTERS[i], y, 11, { center: true }));
  };

  // หัวเอกสาร
  text(d.book_no ?? '', 523, 786, 10);
  text(d.run_no ?? d.cert_no, 523, 770, 10, { maxW: 36 });
  // ผู้หักภาษี / ผู้ถูกหักภาษี
  digits(d.payer.tax_id ?? '', 747);
  text(d.payer.name ?? '', 56, 732, 10, { maxW: 258 });
  text(d.payer.address ?? '', 63, 709, 9.5, { maxW: 485 });
  digits(d.payee.tax_id ?? '', 679);
  text(d.payee.name ?? '', 56, 661, 10, { maxW: 258 });
  text(d.payee.address ?? '', 63, 633, 9.5, { maxW: 485 });
  if (d.seq_in_form) text(String(d.seq_in_form), 108, 605, 10, { center: true });
  if (d.form_choice && CHECK_RECTS[d.form_choice]) tick(...CHECK_RECTS[d.form_choice]);

  // แถวประเภทเงินได้
  const row = ROW[d.income_category] ?? ROW['5'];
  const base = +d.base_amount, tax = +d.wht_amount;
  const pay = thDate(d.pay_date);
  const money = (n: number, y: number, bahtRight: number, satangX: number) => {
    const [b, s] = fmt(n).split('.'); text(b, bahtRight, y, 10, { right: true }); text(s, satangX, y, 10);
  };
  text(`${pay.d}/${pay.m}/${pay.y}`, (COL.date[0] + COL.date[1]) / 2, row.y, 9.5, { center: true });
  money(base, row.y, COL.payBahtRight, COL.paySatang);
  money(tax, row.y, COL.taxBahtRight, COL.taxSatang);
  if (d.income_category === '6' && d.income_note) text(d.income_note, 100, row.y, 9, { maxW: 220 });
  // รวม
  money(base, 183, COL.payBahtRight, COL.paySatang);
  money(tax, 183, COL.taxBahtRight, COL.taxSatang);
  text(bahtText(tax), 190, 163, 10.5, { maxW: 365 });
  // เงินกองทุน
  if (+d.fund_gpf) text(fmt(+d.fund_gpf), 270, 144, 9, { right: true });
  if (+d.fund_sso) text(fmt(+d.fund_sso), 404, 144, 9, { right: true });
  if (+d.fund_pvd) text(fmt(+d.fund_pvd), 543, 144, 9, { right: true });
  // ผู้จ่ายเงิน
  const c = COND_RECTS[d.payer_condition]; if (c) tick(...c);
  if (d.payer_condition === 'other' && d.payer_condition_note) text(d.payer_condition_note, 470, 122, 8, { maxW: 88 });
  // วันที่ออกหนังสือ
  const iss = thDate(d.issue_date);
  text(iss.d, 354, 76, 10, { center: true }); text(iss.m, 396, 76, 10, { center: true }); text(iss.y, 449, 76, 10, { center: true });

  pdf.setTitle(`หนังสือรับรองการหักภาษี ณ ที่จ่าย ${d.cert_no}`);
  return pdf.save();
}
