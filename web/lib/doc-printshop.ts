import fs from 'node:fs';
import path from 'node:path';
import { PDFDocument, PDFFont, PDFPage, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { DOC_TITLE, type DocView } from './doc-view';
import { bahtText } from './baht-text';
import { docSummary, SIGNERS } from './doc-calc';

// กระดาษต่อเนื่องแบบ 'โรงพิมพ์' (ตาม FA): โรงพิมพ์พิมพ์แบบฟอร์มล่วงหน้า (เส้นกรอบ/ป้ายชื่อช่อง/ข้อมูลบริษัท)
// ระบบพิมพ์เฉพาะข้อมูลลงช่อง · แม่แบบสำหรับส่งโรงพิมพ์ = หน้าเดียวกันที่พิมพ์เฉพาะส่วนคงที่ (blank=true)
// ขนาดหน้า 612x792 pt (กระดาษต่อเนื่อง 8.5x11 นิ้ว) · พิกัดทั้งหมดตายตัว เพื่อให้ข้อมูลตรงช่องทุกใบ
const ASSETS = () => { const a = path.join(process.cwd(), 'assets'); return fs.existsSync(a) ? a : path.join(process.cwd(), 'web/assets'); };
const fmt = (n: unknown) => Number(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtyFmt = (n: unknown) => Number(n ?? 0).toLocaleString('en-US', { maximumFractionDigits: 4 });
const thDate = (iso: string) => { const [y, m, d] = iso.slice(0, 10).split('-'); return `${d}/${m}/${+y + 543}`; };
const isThai = (c: string) => /[฀-๿]/.test(c);

export const W = 612, H = 792, ROWS = 16, ROW_H = 20;
const X = { l: 28, r: 584, desc: 52, qty: 300, price: 360, disc: 440, amt: 500, mid: 364 };

/** เอกสารที่แบบโรงพิมพ์รองรับ (FA: ใช้ร่วมกับมัดจำ/ใบวางบิลไม่ได้) — นอกนั้นพิมพ์ด้วยรูปแบบมาตรฐาน */
export const supportsPrintshop = (v: DocView) => ['QT', 'INV', 'CA', 'CN', 'DN'].includes(v.doc.doc_type) && !v.doc.is_deposit && Number(v.doc.deposit_net ?? 0) === 0;

export interface PsCompany { name: string; address: string | null; tax_id: string | null }
/** blank=true → แม่แบบเปล่าสำหรับโรงพิมพ์ (เฉพาะส่วนคงที่ + ข้อมูลบริษัท) · blank=false → พิมพ์เฉพาะข้อมูล */
export async function buildPrintshopPdf(opts: { v?: DocView; docType: string; company: PsCompany | null; blank: boolean }): Promise<Uint8Array> {
  const { v, docType, company, blank } = opts;
  const pdf = await PDFDocument.create(); pdf.registerFontkit(fontkit);
  const dir = ASSETS(); const f = (n: string) => pdf.embedFont(fs.readFileSync(path.join(dir, 'fonts', n)), { subset: true });
  const F = { th: await f('sarabun-thai-400-normal.woff'), la: await f('sarabun-latin-400-normal.woff'), thB: await f('sarabun-thai-700-normal.woff'), laB: await f('sarabun-latin-700-normal.woff') };
  const ink = rgb(0.05, 0.05, 0.08);
  const runs = (s: string) => { const out: [string, boolean][] = []; for (const ch of s) { const th = isThai(ch) || ch === '฿'; const last = out[out.length - 1]; if (last && last[1] === th) last[0] += ch; else out.push([ch, th]); } return out; };
  const font = (th: boolean, bold: boolean): PDFFont => (th ? (bold ? F.thB : F.th) : (bold ? F.laB : F.la));
  const width = (s: string, size: number, bold = false) => runs(s).reduce((w, [x, th]) => w + font(th, bold).widthOfTextAtSize(x, size), 0);
  const put = (page: PDFPage, s: string, x: number, y: number, size = 10, o: { bold?: boolean; right?: boolean; center?: boolean } = {}) => {
    if (!s) return; let cx = o.right ? x - width(s, size, o.bold) : o.center ? x - width(s, size, o.bold) / 2 : x;
    for (const [x2, th] of runs(s)) { page.drawText(x2, { x: cx, y, size, font: font(th, !!o.bold), color: ink }); cx += font(th, !!o.bold).widthOfTextAtSize(x2, size); }
  };
  const wrap = (s: string, size: number, maxW: number) => { const out: string[] = []; for (const para of String(s ?? '').split('\n')) { let line = ''; for (const ch of para) { if (width(line + ch, size) > maxW && line) { out.push(line); line = ch; } else line += ch; } out.push(line); } return out; };
  const S = (page: PDFPage, s: string, x: number, y: number, size = 10, o: { bold?: boolean; right?: boolean; center?: boolean } = {}) => { if (blank) put(page, s, x, y, size, o); };   // ส่วนคงที่: พิมพ์เฉพาะแม่แบบ
  const D = (page: PDFPage, s: string, x: number, y: number, size = 10, o: { bold?: boolean; right?: boolean; center?: boolean } = {}) => { if (!blank) put(page, s, x, y, size, o); };   // ข้อมูล
  const box = (page: PDFPage, x: number, y: number, w: number, h: number) => { if (blank) page.drawRectangle({ x, y, width: w, height: h, borderColor: ink, borderWidth: 0.8 }); };
  const line = (page: PDFPage, x1: number, y1: number, x2: number, y2: number) => { if (blank) page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 0.6, color: ink }); };

  const title = DOC_TITLE[docType]?.title ?? '';
  const sum = v ? docSummary(v) : null;
  const rowsOf = (v: DocView) => v.lines.flatMap(l => {
    const d = wrap(l.description + (l.detail ? `\n${l.detail}` : ''), 9.5, X.qty - X.desc - 8);
    return d.map((t, i) => ({ no: i === 0 ? String(l.line_no) : '', t, l: i === 0 ? l : null }));
  });
  const rows = v ? rowsOf(v) : [];
  const pages = blank ? 1 : Math.max(1, Math.ceil(rows.length / ROWS));
  for (let p = 0; p < pages; p++) {
    const page = pdf.addPage([W, H]);
    // ---- ส่วนคงที่ (แม่แบบ) ----
    const cn = company?.name ?? ''; let cy = 764;
    S(page, cn, X.l, cy, 13, { bold: true }); cy -= 14;
    for (const ln of wrap(company?.address ?? '', 9, 300)) { S(page, ln, X.l, cy, 9); cy -= 11; }
    if (company?.tax_id) S(page, `เลขประจำตัวผู้เสียภาษี ${company.tax_id}`, X.l, cy, 9);
    S(page, title, X.r, 764, 16, { bold: true, right: true });
    box(page, X.l, 580, 330, 100); S(page, 'ลูกค้า', X.l + 5, 669, 8.5);
    box(page, X.mid, 580, X.r - X.mid, 100);
    ['เลขที่', 'วันที่', 'เครดิต', 'ครบกำหนด', 'พนักงานขาย'].forEach((k, i) => { S(page, k, X.mid + 5, 664 - i * 20, 9.5); if (i) line(page, X.mid, 680 - i * 20, X.r, 680 - i * 20); });
    box(page, X.l, 556, X.r - X.l, 24);   // หัวตาราง
    S(page, '#', (X.l + X.desc) / 2, 564, 9.5, { center: true }); S(page, 'รายละเอียด', (X.desc + X.qty) / 2, 564, 9.5, { center: true });
    S(page, 'จำนวน', (X.qty + X.price) / 2, 564, 9.5, { center: true }); S(page, 'ราคาต่อหน่วย', (X.price + X.disc) / 2, 564, 9.5, { center: true });
    S(page, 'ส่วนลด', (X.disc + X.amt) / 2, 564, 9.5, { center: true }); S(page, 'มูลค่า', (X.amt + X.r) / 2, 564, 9.5, { center: true });
    const bodyTop = 556, bodyBot = bodyTop - ROWS * ROW_H;   // 556 → 236
    box(page, X.l, bodyBot, X.r - X.l, ROWS * ROW_H);
    [X.desc, X.qty, X.price, X.disc, X.amt].forEach(x => { line(page, x, 580, x, bodyBot); });
    box(page, X.l, 150, 330, 86); S(page, 'จำนวนเงินตัวอักษร', X.l + 5, 226, 8.5);
    box(page, X.mid, 150, X.r - X.mid, 86);
    ['รวมเป็นเงิน', 'ส่วนลด', 'ภาษีมูลค่าเพิ่ม', 'จำนวนเงินรวมทั้งสิ้น'].forEach((k, i) => { S(page, k, X.mid + 5, 220 - i * 21.5, 9.5, { bold: i === 3 }); if (i) line(page, X.mid, 236 - i * 21.5, X.r, 236 - i * 21.5); });
    box(page, X.l, 100, X.r - X.l, 46); S(page, 'หมายเหตุ', X.l + 5, 136, 8.5);
    const [sl, sr] = SIGNERS[docType] ?? ['ผู้รับสินค้า / บริการ', 'ผู้อนุมัติ'];
    [[X.l + 20, sl], [X.mid + 10, sr]].forEach(([x, cap]) => { const xx = x as number;
      line(page, xx, 58, xx + 130, 58); line(page, xx + 140, 58, xx + 200, 58); S(page, cap as string, xx + 65, 46, 9, { center: true }); S(page, 'วันที่', xx + 170, 46, 9, { center: true }); });
    // ---- ข้อมูล ----
    if (v) {
      D(page, v.contact.name, X.l + 8, 654, 11, { bold: true });
      let ay = 640; for (const ln of wrap(v.contact.address ?? '', 9.5, 314).slice(0, 4)) { D(page, ln, X.l + 8, ay, 9.5); ay -= 12; }
      if (v.contact.tax_id) D(page, `เลขประจำตัวผู้เสียภาษี ${v.contact.tax_id}`, X.l + 8, Math.min(ay, 592), 9.5);
      const d = v.doc, credit = Number(d.credit_days ?? v.contact.credit_days ?? 0);
      const mv = [d.doc_no, thDate(d.doc_date), credit > 0 ? `${credit} วัน` : '', d.due_date && d.doc_type !== 'QT' ? thDate(d.due_date) : '', d.salesperson ?? ''];
      mv.forEach((val, i) => D(page, val, X.r - 6, 664 - i * 20, 9.5, { right: true }));
      rows.slice(p * ROWS, (p + 1) * ROWS).forEach((r, i) => { const y = bodyTop - 14 - i * ROW_H;
        D(page, r.no, (X.l + X.desc) / 2, y, 9.5, { center: true }); D(page, r.t, X.desc + 4, y, 9.5);
        if (r.l) { D(page, qtyFmt(r.l.qty) + (r.l.unit ? ` ${r.l.unit}` : ''), X.price - 5, y, 9.5, { right: true }); D(page, fmt(r.l.unit_price), X.disc - 5, y, 9.5, { right: true });
          if (Number(r.l.discount) > 0) D(page, fmt(r.l.discount), X.amt - 5, y, 9.5, { right: true }); D(page, fmt(r.l.amount), X.r - 5, y, 9.5, { right: true }); } });
      if (p === pages - 1 && sum) {
        const by = (re: RegExp) => sum.rows.find(r => re.test(r.label))?.value;
        const vals = [by(/^รวมเป็นเงิน/), by(/^ส่วนลดรวม/), by(/^ภาษีมูลค่าเพิ่ม/), sum.rows.find(r => r.strong)?.value];
        vals.forEach((val, i) => { if (val != null) D(page, fmt(val), X.r - 6, 220 - i * 21.5, 9.5, { right: true, bold: i === 3 }); });
        wrap(`(${bahtText(Number(sum.total))})`, 10, 316).slice(0, 3).forEach((ln, i) => D(page, ln, X.l + 8, 208 - i * 13, 10));
        const w = sum.wht.length ? Number(sum.wht[0].value) : 0;
        const note = [v.doc.reason || v.doc.note || '', w > 0 ? `หักภาษี ณ ที่จ่าย ${fmt(w)} บาท ยอดจ่าย ${fmt(sum.wht[1]?.value)} บาท` : ''].filter(Boolean).join('  ');
        wrap(note, 9.5, 540).slice(0, 2).forEach((ln, i) => D(page, ln, X.l + 8, 124 - i * 12, 9.5));
      }
    }
  }
  if (!blank) pdf.getPages().forEach((pg, i, a) => put(pg, `หน้า ${i + 1}/${a.length}`, X.r, 18, 8.5, { right: true }));
  return pdf.save();
}
