import fs from 'node:fs';
import path from 'node:path';
import { PDFDocument, PDFFont, PDFPage, rgb, degrees } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { DOC_TITLE, type DocView } from './doc-view';
import { bahtText } from './wht-pdf';
import { docSummary, lineTaxLabel, lineWhtLabel, SIGNERS } from './doc-calc';

const ASSETS = () => { const a = path.join(process.cwd(), 'assets'); return fs.existsSync(a) ? a : path.join(process.cwd(), 'web/assets'); };
const fmt = (n: unknown) => Number(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtyFmt = (n: unknown) => Number(n ?? 0).toLocaleString('en-US', { maximumFractionDigits: 4 });
const thDate = (iso: string) => { const [y, m, d] = iso.slice(0, 10).split('-'); return `${d}/${m}/${+y + 543}`; };
const isThai = (c: string) => /[฀-๿]/.test(c);

export type PdfMode = 'original' | 'copy' | 'both';

export async function buildDocPdf(v: DocView, mode: PdfMode = 'original'): Promise<Uint8Array> {
  const dir = ASSETS();
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const f = (n: string) => pdf.embedFont(fs.readFileSync(path.join(dir, 'fonts', n)), { subset: true });
  const F = { th: await f('sarabun-thai-400-normal.woff'), la: await f('sarabun-latin-400-normal.woff'),
              thB: await f('sarabun-thai-700-normal.woff'), laB: await f('sarabun-latin-700-normal.woff') };
  const t = DOC_TITLE[v.doc.doc_type], col = rgb(...t.rgb), ink = rgb(0.1, 0.1, 0.12), grey = rgb(0.45, 0.45, 0.5);

  const runs = (s: string) => { const out: [string, boolean][] = []; for (const ch of s) {
    const th = isThai(ch) || ch === '฿'; const last = out[out.length - 1];
    if (last && last[1] === th) last[0] += ch; else out.push([ch, th]); } return out; };
  const font = (th: boolean, bold: boolean): PDFFont => (th ? (bold ? F.thB : F.th) : (bold ? F.laB : F.la));
  const width = (s: string, size: number, bold = false) => runs(s).reduce((w, [x, th]) => w + font(th, bold).widthOfTextAtSize(x, size), 0);
  const draw = (page: PDFPage, s: string, x: number, y: number, size = 10, o: { bold?: boolean; right?: boolean; color?: any } = {}) => {
    if (!s) return;
    let cx = o.right ? x - width(s, size, o.bold) : x;
    for (const [x2, th] of runs(s)) {
      page.drawText(x2, { x: cx, y, size, font: font(th, !!o.bold), color: o.color ?? ink });
      cx += font(th, !!o.bold).widthOfTextAtSize(x2, size);
    }
  };
  // ตัดบรรทัดตามความกว้าง
  const wrap = (s: string, size: number, maxW: number) => {
    const out: string[] = [];
    for (const para of String(s ?? '').split('\n')) {
      let line = '';
      for (const ch of para) { if (width(line + ch, size) > maxW && line) { out.push(line); line = ch; } else line += ch; }
      out.push(line);
    }
    return out;
  };

  const L = 42, R = 553, W = 595, H = 842;
  const sheet = (label: string) => {
    let page = pdf.addPage([W, H]); let y = H - 48;
    page.drawRectangle({ x: 0, y: H - 14, width: W, height: 14, color: col });
    // หัว: บริษัท (ซ้าย) / ชื่อเอกสาร (ขวา)
    draw(page, v.company?.name ?? '', L, y, 13, { bold: true });
    wrap(v.company?.address ?? '', 9.5, 280).forEach((ln, i) => draw(page, ln, L, y - 15 - i * 12, 9.5, { color: grey }));
    const addrN = wrap(v.company?.address ?? '', 9.5, 280).length;
    if (v.company?.tax_id) draw(page, `เลขประจำตัวผู้เสียภาษี ${v.company.tax_id}`, L, y - 15 - addrN * 12, 9.5, { color: grey });
    draw(page, t.title, R, y, 16, { bold: true, right: true, color: col });
    draw(page, label, R, y - 18, 10.5, { right: true, color: grey });
    y -= 78;
    // ลูกค้า + เลขที่/วันที่
    draw(page, 'ลูกค้า', L, y, 9, { color: grey });
    draw(page, v.contact.name, L, y - 13, 11, { bold: true });
    let cy = y - 27;
    for (const ln of wrap(v.contact.address ?? '', 9.5, 270)) { draw(page, ln, L, cy, 9.5); cy -= 12; }
    if (v.contact.tax_id) { draw(page, `เลขประจำตัวผู้เสียภาษี ${v.contact.tax_id}`, L, cy, 9.5); cy -= 12; }
    const meta: [string, string][] = [['เลขที่', v.doc.doc_no], ['วันที่', thDate(v.doc.doc_date)]];
    if (v.contact.credit_days > 0) meta.push(['เครดิต', `${v.contact.credit_days} วัน`]);
    if (v.doc.due_date && v.doc.doc_type !== 'QT') meta.push(['ครบกำหนด', thDate(v.doc.due_date)]);
    if (v.doc.salesperson) meta.push(['พนักงานขาย', v.doc.salesperson]);
    if (v.ref && (v.doc.doc_type === 'CN' || v.doc.doc_type === 'DN')) meta.push(['วันที่อ้างอิง', thDate(v.ref.doc_date)]);
    if (v.ref) meta.push(['อ้างอิง', v.ref.doc_no]);
    meta.forEach(([k, val], i) => { draw(page, k, 360, y - i * 14, 10, { color: grey }); draw(page, val, R, y - i * 14, 10, { right: true }); });
    y = Math.min(cy, y - meta.length * 14) - 14;
    return { page, y };
  };
  const tableHead = (page: PDFPage, y: number) => {
    page.drawRectangle({ x: L, y: y - 5, width: R - L, height: 20, color: col });
    const w = rgb(1, 1, 1);
    draw(page, '#', L + 6, y, 10, { bold: true, color: w }); draw(page, 'รายละเอียด', L + 28, y, 10, { bold: true, color: w });
    draw(page, 'จำนวน', 300, y, 10, { bold: true, color: w, right: true });
    draw(page, 'ราคาต่อหน่วย', 372, y, 10, { bold: true, color: w, right: true });
    if (showTax) { draw(page, 'ภาษี', 414, y, 10, { bold: true, color: w, right: true }); draw(page, 'หัก ณ ที่จ่าย', 482, y, 10, { bold: true, color: w, right: true }); }
    draw(page, 'มูลค่า', R - 6, y, 10, { bold: true, color: w, right: true });
    return y - 22;
  };

  const showTax = v.doc.doc_type !== 'BL';
  const sum = docSummary(v);
  const [signL, signR] = SIGNERS[v.doc.doc_type];
  const labels = mode === 'both' ? ['ต้นฉบับ', 'สำเนา'] : [mode === 'copy' ? 'สำเนา' : 'ต้นฉบับ'];
  for (const label of labels) {
    let { page, y } = sheet(label);
    y = tableHead(page, y);
    for (const l of v.lines) {
      const desc = wrap(l.description, 10, 230);
      const h = Math.max(1, desc.length) * 13 + 6;
      if (y - h < 200) { ({ page, y } = sheet(label)); y = tableHead(page, y); }
      draw(page, String(l.line_no), L + 6, y, 10);
      desc.forEach((ln, i) => draw(page, ln, L + 28, y - i * 13, 10));
      draw(page, qtyFmt(l.qty), 300, y, 10, { right: true }); draw(page, fmt(l.unit_price), 372, y, 10, { right: true });
      if (showTax) { draw(page, lineTaxLabel(v), 414, y, 10, { right: true }); draw(page, lineWhtLabel(v), 482, y, 10, { right: true }); }
      draw(page, fmt(l.amount), R - 6, y, 10, { right: true });
      page.drawLine({ start: { x: L, y: y - 8 }, end: { x: R, y: y - 8 }, thickness: 0.4, color: rgb(0.85, 0.85, 0.88) });
      y -= h;
    }
    // สรุปยอด
    const need = (sum.rows.length + sum.wht.length) * 15 + 150;
    if (y < need) ({ page, y } = sheet(label));
    y -= 6;
    draw(page, `(${bahtText(Number(sum.total))})`, L, y - (sum.rows.length * 15) / 2, 10);
    const put = (rows: typeof sum.rows) => rows.forEach(r => {
      if (r.gap) y -= 5;
      draw(page, r.label, 440, y, r.strong ? 11 : 10, { bold: r.strong, right: true, color: r.strong ? col : ink });
      draw(page, `${fmt(r.value)} บาท`, R - 6, y, r.strong ? 11 : 10, { bold: r.strong, right: true });
      y -= 15;
    });
    put(sum.rows);
    if (sum.wht.length) { y -= 4; page.drawLine({ start: { x: 330, y: y + 10 }, end: { x: R, y: y + 10 }, thickness: 0.4, color: rgb(0.8, 0.8, 0.84) }); put(sum.wht); }
    y -= 6;
    if (v.doc.reason) { draw(page, 'หมายเหตุ', L, y, 9.5, { color: col }); wrap(v.doc.reason, 10, 500).forEach((ln, i) => draw(page, ln, L, y - 13 - i * 12, 10)); }
    // ลายเซ็น (ในนาม + ช่องเซ็น + วันที่)
    const sy = 84;
    [[L, signL, v.contact.name], [312, signR, v.company?.name ?? '']].forEach(([x, cap, who]) => {
      const xx = x as number;
      draw(page, `ในนาม ${who}`, xx, sy + 52, 9.5, { color: grey });
      page.drawLine({ start: { x: xx, y: sy + 14 }, end: { x: xx + 138, y: sy + 14 }, thickness: 0.6, color: grey });
      page.drawLine({ start: { x: xx + 148, y: sy + 14 }, end: { x: xx + 238, y: sy + 14 }, thickness: 0.6, color: grey });
      draw(page, cap as string, xx + 69 - width(cap as string, 9.5) / 2, sy, 9.5, { color: grey });
      draw(page, 'วันที่', xx + 193 - width('วันที่', 9.5) / 2, sy, 9.5, { color: grey });
    });
    if (v.doc.status === 'cancelled') {
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
