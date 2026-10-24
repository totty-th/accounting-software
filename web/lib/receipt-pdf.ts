import fs from 'node:fs';
import path from 'node:path';
import { PDFDocument, PDFFont, PDFPage, rgb, degrees } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { ReceiptView } from '@/components/ReceiptSheet';
import { bahtText } from './wht-pdf';
import { SIGNERS } from './doc-calc';
import type { PdfMode } from './doc-pdf';

const ASSETS = () => { const a = path.join(process.cwd(), 'assets'); return fs.existsSync(a) ? a : path.join(process.cwd(), 'web/assets'); };
const fmt = (n: unknown) => Number(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const thDate = (iso?: string | null) => { if (!iso) return ''; const [y, m, d] = iso.slice(0, 10).split('-'); return `${d}/${m}/${+y + 543}`; };
const isThai = (c: string) => /[฀-๿]/.test(c);
export const PAY_METHODS: [string, string][] = [['cash', 'เงินสด'], ['cheque', 'เช็ค'], ['transfer', 'โอนเงิน'], ['card', 'บัตรเครดิต'], ['other', 'อื่นๆ']];

// ใบเสร็จรับเงิน PDF (A4) ตามแบบเดียวกับหน้าจอ: รายการเอกสาร สรุปยอด ช่องทางรับชำระ ลายเซ็น
export async function buildReceiptPdf(v: ReceiptView, mode: PdfMode = 'original'): Promise<Uint8Array> {
  const dir = ASSETS();
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const f = (n: string) => pdf.embedFont(fs.readFileSync(path.join(dir, 'fonts', n)), { subset: true });
  const F = { th: await f('sarabun-thai-400-normal.woff'), la: await f('sarabun-latin-400-normal.woff'),
              thB: await f('sarabun-thai-700-normal.woff'), laB: await f('sarabun-latin-700-normal.woff') };
  const col = rgb(0.18, 0.55, 0.24), ink = rgb(0.1, 0.1, 0.12), grey = rgb(0.45, 0.45, 0.5);
  const runs = (s: string) => { const out: [string, boolean][] = []; for (const ch of s) {
    const th = isThai(ch) || ch === '฿'; const last = out[out.length - 1];
    if (last && last[1] === th) last[0] += ch; else out.push([ch, th]); } return out; };
  const font = (th: boolean, bold: boolean): PDFFont => (th ? (bold ? F.thB : F.th) : (bold ? F.laB : F.la));
  const width = (s: string, size: number, bold = false) => runs(s).reduce((w, [x, th]) => w + font(th, bold).widthOfTextAtSize(x, size), 0);
  const draw = (page: PDFPage, s: string, x: number, y: number, size = 10, o: { bold?: boolean; right?: boolean; color?: any } = {}) => {
    if (!s) return;
    let cx = o.right ? x - width(s, size, o.bold) : x;
    for (const [x2, th] of runs(s)) { page.drawText(x2, { x: cx, y, size, font: font(th, !!o.bold), color: o.color ?? ink }); cx += font(th, !!o.bold).widthOfTextAtSize(x2, size); }
  };
  const wrap = (s: string, size: number, maxW: number) => {
    const out: string[] = [];
    for (const para of String(s ?? '').split('\n')) { let line = '';
      for (const ch of para) { if (width(line + ch, size) > maxW && line) { out.push(line); line = ch; } else line += ch; }
      out.push(line); }
    return out;
  };
  const L = 42, R = 553, W = 595, H = 842;
  const r = v.receipt, net = Math.round(Number(r.amount) * 100 - Number(r.wht) * 100) / 100, hasTax = r.vat_rate != null;
  const [signL, signR] = SIGNERS.RE;
  const sheet = (label: string) => {
    const page = pdf.addPage([W, H]); let y = H - 48;
    page.drawRectangle({ x: 0, y: H - 14, width: W, height: 14, color: col });
    draw(page, v.company?.name ?? '', L, y, 13, { bold: true });
    const addr = wrap(v.company?.address ?? '', 9.5, 280);
    addr.forEach((ln, i) => draw(page, ln, L, y - 15 - i * 12, 9.5, { color: grey }));
    if (v.company?.tax_id) draw(page, `เลขประจำตัวผู้เสียภาษี ${v.company.tax_id}`, L, y - 15 - addr.length * 12, 9.5, { color: grey });
    draw(page, 'ใบเสร็จรับเงิน', R, y, 16, { bold: true, right: true, color: col });
    draw(page, label, R, y - 18, 10.5, { right: true, color: grey });
    y -= 78;
    draw(page, 'ลูกค้า', L, y, 9, { color: grey });
    draw(page, v.contact.name, L, y - 13, 11, { bold: true });
    let cy = y - 27;
    for (const ln of wrap(v.contact.address ?? '', 9.5, 270)) { draw(page, ln, L, cy, 9.5); cy -= 12; }
    if (v.contact.tax_id) { draw(page, `เลขประจำตัวผู้เสียภาษี ${v.contact.tax_id}`, L, cy, 9.5); cy -= 12; }
    [['เลขที่', r.receipt_no], ['วันที่', thDate(r.receipt_date)]].forEach(([k, val], i) => {
      draw(page, k, 400, y - i * 14, 10, { color: grey }); draw(page, val, R, y - i * 14, 10, { right: true }); });
    return { page, y: Math.min(cy, y - 28) - 14 };
  };
  const X = { no: L + 6, doc: L + 26, date: 250, due: 318, tot: 420, wht: 480, amt: R - 6 };
  const head = (page: PDFPage, y: number) => {
    page.drawRectangle({ x: L, y: y - 5, width: R - L, height: 20, color: col });
    const w = rgb(1, 1, 1);
    draw(page, '#', X.no, y, 10, { bold: true, color: w }); draw(page, 'เลขที่เอกสาร', X.doc, y, 10, { bold: true, color: w });
    draw(page, 'เอกสารวันที่', X.date - 30, y, 10, { bold: true, color: w }); draw(page, 'ครบกำหนด', X.due - 28, y, 10, { bold: true, color: w });
    draw(page, 'ยอดรวม', X.tot, y, 10, { bold: true, color: w, right: true }); draw(page, 'หัก ณ ที่จ่าย', X.wht, y, 10, { bold: true, color: w, right: true });
    draw(page, 'ยอดชำระ', X.amt, y, 10, { bold: true, color: w, right: true });
    return y - 22;
  };
  const labels = mode === 'both' ? ['ต้นฉบับ', 'สำเนา'] : [mode === 'copy' ? 'สำเนา' : 'ต้นฉบับ'];
  for (const label of labels) {
    let { page, y } = sheet(label); y = head(page, y);
    for (const i of v.items) {
      if (y < 330) { ({ page, y } = sheet(label)); y = head(page, y); }
      draw(page, String(i.line_no), X.no, y, 10); draw(page, i.doc_no ?? i.description ?? '', X.doc, y, 10);
      draw(page, thDate(i.doc_date), X.date - 30, y, 10); draw(page, thDate(i.due_date), X.due - 28, y, 10);
      if (i.doc_total != null) draw(page, fmt(i.doc_total), X.tot, y, 10, { right: true });
      draw(page, fmt(i.wht), X.wht, y, 10, { right: true }); draw(page, fmt(i.amount), X.amt, y, 10, { right: true });
      page.drawLine({ start: { x: L, y: y - 8 }, end: { x: R, y: y - 8 }, thickness: 0.4, color: rgb(0.85, 0.85, 0.88) });
      y -= 20;
    }
    if (y < 330) ({ page, y } = sheet(label));
    y -= 6;
    const rows: [string, string, boolean?][] = [['จำนวนรวม', `${v.items.length} รายการ`], ['รวมเป็นเงิน', `${fmt(r.amount)} บาท`]];
    if (hasTax) rows.push(['มูลค่าที่ไม่มี/ยกเว้นภาษี', `${fmt(0)} บาท`], ['มูลค่าที่คำนวณภาษี', `${fmt(r.base)} บาท`], [`ภาษีมูลค่าเพิ่ม ${Number(r.vat_rate)}%`, `${fmt(r.vat)} บาท`]);
    rows.push(['จำนวนเงินรวมทั้งสิ้น', `${fmt(r.amount)} บาท`, true], ['หักภาษี ณ ที่จ่ายทั้งสิ้น', `${fmt(r.wht)} บาท`], ['ยอดชำระ', `${fmt(net)} บาท`, true]);
    draw(page, `(${bahtText(Number(r.amount))})`, L, y, 10);
    for (const [k, val, strong] of rows) {
      draw(page, k, 450, y, strong ? 11 : 10, { bold: strong, right: true, color: strong ? col : ink });
      draw(page, val, R - 6, y, strong ? 11 : 10, { bold: strong, right: true }); y -= 15;
    }
    // ส่วนการชำระเงิน
    y -= 8;
    draw(page, 'การชำระเงินจะสมบูรณ์เมื่อบริษัทได้รับเงินเรียบร้อยแล้ว', L, y, 9.5, { color: grey });
    const used = new Set(v.payments.map(p => p.method));
    let bx = 300;
    for (const [k, name] of PAY_METHODS.slice(0, 4)) {
      page.drawRectangle({ x: bx, y: y - 1, width: 10, height: 10, borderColor: grey, borderWidth: 0.8 });
      if (used.has(k)) { draw(page, '✓', bx + 1.5, y, 9, { bold: true, color: col }); page.drawLine({ start: { x: bx + 2, y: y + 4 }, end: { x: bx + 4.5, y: y + 1 }, thickness: 1.4, color: col }); page.drawLine({ start: { x: bx + 4.5, y: y + 1 }, end: { x: bx + 9, y: y + 8 }, thickness: 1.4, color: col }); }
      draw(page, name, bx + 14, y, 9.5); bx += 14 + width(name, 9.5) + 12;
    }
    y -= 18;
    const P = v.payments.length ? v.payments : [null];
    for (const p of P) {
      const mname = p ? PAY_METHODS.find(m => m[0] === p.method)?.[1] ?? '' : '';
      const cells: [string, string, number, number][] = [['ธนาคาร', p?.bank ?? (p ? mname : ''), L, 150], ['เลขที่', p?.ref_no ?? '', L + 160, 110],
        ['วันที่', thDate(p?.pay_date), L + 280, 90], ['จำนวนเงิน', p ? fmt(p.amount) : '', L + 380, 131]];
      for (const [k, val, x, w] of cells) {
        draw(page, k, x, y, 9, { color: grey }); const kw = width(k, 9) + 4;
        page.drawLine({ start: { x: x + kw, y: y - 2 }, end: { x: x + w, y: y - 2 }, thickness: 0.5, color: grey });
        draw(page, val, x + kw + 3, y, 9.5);
      }
      y -= 16;
    }
    const sy = 84;
    [[L, signL, v.contact.name], [312, signR, v.company?.name ?? '']].forEach(([x, cap, who]) => {
      const xx = x as number;
      draw(page, `ในนาม ${who}`, xx, sy + 52, 9.5, { color: grey });
      page.drawLine({ start: { x: xx, y: sy + 14 }, end: { x: xx + 138, y: sy + 14 }, thickness: 0.6, color: grey });
      page.drawLine({ start: { x: xx + 148, y: sy + 14 }, end: { x: xx + 238, y: sy + 14 }, thickness: 0.6, color: grey });
      draw(page, cap as string, xx + 69 - width(cap as string, 9.5) / 2, sy, 9.5, { color: grey });
      draw(page, 'วันที่', xx + 193 - width('วันที่', 9.5) / 2, sy, 9.5, { color: grey });
    });
    if (r.status === 'cancelled') {
      const wm = 'ยกเลิก', size = 110, wmW = width(wm, size);
      let cx = W / 2 - (wmW * 0.7) / 2 - 40, cy = H / 2 - 60;
      for (const [x2, th] of runs(wm)) {
        page.drawText(x2, { x: cx, y: cy, size, font: font(th, true), color: rgb(0.85, 0.2, 0.2), opacity: 0.16, rotate: degrees(24) });
        const adv = font(th, true).widthOfTextAtSize(x2, size); cx += adv * Math.cos(Math.PI * 24 / 180); cy += adv * Math.sin(Math.PI * 24 / 180);
      }
    }
  }
  const pages = pdf.getPages();
  pages.forEach((pg, i) => draw(pg, `หน้า ${i + 1}/${pages.length}`, R, 24, 9, { right: true, color: grey }));
  return pdf.save();
}
