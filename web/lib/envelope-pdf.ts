import fs from 'node:fs';
import path from 'node:path';
import { PDFDocument, PDFFont, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { DocView } from './doc-view';

const ASSETS = () => { const a = path.join(process.cwd(), 'assets'); return fs.existsSync(a) ? a : path.join(process.cwd(), 'web/assets'); };
const isThai = (c: string) => /[฀-๿]/.test(c);

/** จ่าหน้าซองหนึ่งใบต่อหนึ่งเอกสาร (ซอง DL 220×110 มม. แนวนอน) · ผู้ส่งซ้ายบน · "กรุณานำส่ง" + ชื่อ/ที่อยู่ลูกค้ากลาง-ขวา (ตามที่ FA พิมพ์) */
export async function buildEnvelopePdf(views: DocView[]): Promise<Uint8Array> {
  const dir = ASSETS();
  const pdf = await PDFDocument.create(); pdf.registerFontkit(fontkit);
  const f = (n: string) => pdf.embedFont(fs.readFileSync(path.join(dir, 'fonts', n)), { subset: true });
  const F = { th: await f('sarabun-thai-400-normal.woff'), la: await f('sarabun-latin-400-normal.woff'),
              thB: await f('sarabun-thai-700-normal.woff'), laB: await f('sarabun-latin-700-normal.woff') };
  const font = (th: boolean, b: boolean): PDFFont => (th ? (b ? F.thB : F.th) : (b ? F.laB : F.la));
  const runs = (s: string) => { const o: [string, boolean][] = []; for (const ch of s) { const th = isThai(ch) || ch === '฿'; const l = o[o.length - 1]; if (l && l[1] === th) l[0] += ch; else o.push([ch, th]); } return o; };
  const width = (s: string, sz: number, b = false) => runs(s).reduce((w, [x, th]) => w + font(th, b).widthOfTextAtSize(x, sz), 0);
  const W = 623.6, H = 311.8, X = 238, MAXW = W - X - 30;
  const wrap = (text: string, sz: number) => {                 // ตัดบรรทัดตามความกว้าง (ภาษาไทยไม่มีช่องว่าง → ตัดทีละตัวอักษรเมื่อล้น)
    const lines: string[] = [];
    for (const para of text.split(/\r?\n/)) {
      let cur = '';
      for (const ch of para) { if (width(cur + ch, sz) > MAXW && cur) { lines.push(cur); cur = ch; } else cur += ch; }
      lines.push(cur);
    }
    return lines.filter(l => l.trim());
  };
  for (const v of views) {
    const page = pdf.addPage([W, H]);
    const draw = (s: string, x: number, y: number, sz: number, o: { b?: boolean; color?: any } = {}) => {
      let cx = x; for (const [t, th] of runs(s)) { page.drawText(t, { x: cx, y, size: sz, font: font(th, !!o.b), color: o.color ?? rgb(0.05, 0.05, 0.08) }); cx += font(th, !!o.b).widthOfTextAtSize(t, sz); }
    };
    draw(v.company?.name ?? '', 25, H - 55, 13, { b: true });
    draw('กรุณานำส่ง', X, H - 112, 15, { color: rgb(0.25, 0.4, 0.55) });
    let y = H - 132;
    draw(v.contact.name, X, y, 16);
    for (const l of wrap(v.contact.address ?? '', 16)) { y -= 17; draw(l, X, y, 16); }
  }
  return pdf.save();
}
