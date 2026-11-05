import fs from 'node:fs';
import path from 'node:path';
import { PDFDocument, PDFFont, PDFPage, rgb, degrees } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { DOC_TITLE, type DocView } from './doc-view';
import { bahtText } from './wht-pdf';
import { docSummary, isFull, SIGNERS } from './doc-calc';

// รูปแบบเอกสาร 'แบรนด์' (ตามตัวอย่างใบเสนอราคา TMP-QT2026-00050): หัวเอกสารมีชื่อบริษัท/โลโก้กลาง/ชื่อเอกสารขวา · กล่องลูกค้า
// · ตารางหัวสีกรม · สรุปยอดชิดขวา · ท้ายเอกสาร ช่องเซ็นลูกค้า / ตราประทับกลาง / ผู้ลงนามบริษัท · รหัสแบบฟอร์มท้ายหน้า (A4 เท่านั้น)
const ASSETS = () => { const a = path.join(process.cwd(), 'assets'); return fs.existsSync(a) ? a : path.join(process.cwd(), 'web/assets'); };
const fmt = (n: unknown) => Number(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtyFmt = (n: unknown) => Number(n ?? 0).toLocaleString('en-US', { maximumFractionDigits: 4 });
const thDate = (iso: string) => { const [y, m, d] = iso.slice(0, 10).split('-'); return `${d}/${m}/${y}`; };   // ตามตัวอย่าง: ปี ค.ศ.
const isThai = (c: string) => /[฀-๿]/.test(c);
const EN_TITLE: Record<string, string> = { QT: 'QUOTATION', INV: 'INVOICE / TAX INVOICE', CA: 'CASH SALE / TAX INVOICE', BL: 'BILLING NOTE', CN: 'CREDIT NOTE', DN: 'DEBIT NOTE' };

export async function buildBrandedPdf(v: DocView, mode: 'original' | 'copy' | 'both'): Promise<Uint8Array> {
  const dz = v.design!, type = v.doc.doc_type, full = isFull(v), co = v.company;
  const dir = ASSETS();
  const pdf = await PDFDocument.create(); pdf.registerFontkit(fontkit);
  const f = (n: string) => pdf.embedFont(fs.readFileSync(path.join(dir, 'fonts', n)), { subset: true });
  const F = { th: await f('sarabun-thai-400-normal.woff'), la: await f('sarabun-latin-400-normal.woff'), thB: await f('sarabun-thai-700-normal.woff'), laB: await f('sarabun-latin-700-normal.woff') };
  const navy = dz.bw ? rgb(0.1, 0.1, 0.12) : rgb(0.11, 0.16, 0.37), ink = rgb(0.1, 0.1, 0.12), grey = rgb(0.38, 0.4, 0.45), line = rgb(0.82, 0.83, 0.87), white = rgb(1, 1, 1);
  const runs = (s: string) => { const out: [string, boolean][] = []; for (const ch of s) { const th = isThai(ch) || ch === '฿'; const l = out[out.length - 1]; if (l && l[1] === th) l[0] += ch; else out.push([ch, th]); } return out; };
  const font = (th: boolean, b: boolean): PDFFont => (th ? (b ? F.thB : F.th) : (b ? F.laB : F.la));
  const width = (s: string, size: number, b = false) => runs(s).reduce((w, [x, th]) => w + font(th, b).widthOfTextAtSize(x, size), 0);
  type O = { bold?: boolean; right?: boolean; center?: boolean; color?: any };
  const draw = (page: PDFPage, s: string, x: number, y: number, size = 10, o: O = {}) => {
    if (!s) return; const w = width(s, size, o.bold); let cx = o.right ? x - w : o.center ? x - w / 2 : x;
    for (const [t, th] of runs(s)) { page.drawText(t, { x: cx, y, size, font: font(th, !!o.bold), color: o.color ?? ink }); cx += font(th, !!o.bold).widthOfTextAtSize(t, size); }
  };
  const wrap = (s: string, size: number, maxW: number, bold = false) => {
    const out: string[] = [];
    for (const para of String(s ?? '').split('\n')) { let ln = ''; for (const ch of para) { if (width(ln + ch, size, bold) > maxW && ln) { out.push(ln); ln = ch; } else ln += ch; } out.push(ln); }
    return out;
  };
  const emb = async (s?: string | null) => { if (!s) return null; const m = /^data:image\/(png|jpeg);base64,(.+)$/.exec(s); if (!m) return null;
    try { const b = Buffer.from(m[2], 'base64'); return m[1] === 'png' ? await pdf.embedPng(b) : await pdf.embedJpg(b); } catch { return null; } };
  const logo = dz.logo !== false ? await emb(v.images?.logo) : null, stamp = dz.stamp !== false ? await emb(v.images?.stamp) : null, sig = await emb(v.images?.signature);

  const W = 595, H = 842, L = 42, R = 553;
  const title = dz.title || DOC_TITLE[type].title;
  const credit = full ? (v.doc.term_mode === 'cash' ? 0 : Number(v.doc.credit_days ?? 0)) : v.contact.credit_days;
  const sheet = (label: string) => {
    const page = pdf.addPage([W, H]); let y = H - 50;
    // ซ้าย: บริษัท
    let cy = y; const LW = logo ? 215 : 280;
    for (const ln of wrap(co?.name ?? '', 13, LW, true)) { draw(page, ln, L, cy, 13, { bold: true, color: navy }); cy -= 16; }
    if (co?.name_en) { for (const ln of wrap(co.name_en, 10, LW, true)) { draw(page, ln, L, cy, 10, { bold: true, color: navy }); cy -= 13; } }
    cy -= 2;
    const contact = [co?.tax_id ? `เลขประจำตัวผู้เสียภาษี ${co.tax_id}` : '', co?.phone ? `โทร ${co.phone}` : ''].filter(Boolean).join(' | ');
    const mail = [co?.email, co?.website].filter(Boolean).join(' | ');
    for (const ln of [...wrap(co?.address ?? '', 8.5, LW), ...(contact ? wrap(contact, 8.5, LW) : []), ...(mail ? wrap(mail, 8.5, LW) : [])]) { draw(page, ln, L, cy, 8.5, { color: grey }); cy -= 11.5; }
    // กลาง: โลโก้
    if (logo) { const k = Math.min(1, 140 / logo.width, 60 / logo.height); page.drawImage(logo, { x: 330 - (logo.width * k) / 2, y: H - 50 - logo.height * k + 14, width: logo.width * k, height: logo.height * k }); }
    // ขวา: ชื่อเอกสาร
    let ry = y;
    for (const ln of wrap(title, 19, logo ? 150 : 200, true)) { draw(page, ln, R, ry - 4, 19, { bold: true, right: true, color: navy }); ry -= 22; }
    draw(page, EN_TITLE[type] ?? '', R, ry, 9, { right: true, color: grey }); ry -= 13;
    draw(page, `เลขที่: ${v.doc.doc_no}`, R, ry, 9.5, { right: true }); ry -= 13;
    if (dz.copy_mark !== false) { draw(page, label, R, ry, 9, { right: true, color: grey }); ry -= 12; }
    y = Math.min(cy, ry) - 6;
    page.drawLine({ start: { x: L, y }, end: { x: R, y }, thickness: 1.6, color: navy });
    y -= 14;
    // กล่องลูกค้า
    const lbl = dz.customer_label || 'ลูกค้า';
    const left: [string, string][] = [[lbl, v.contact.name], ['ที่อยู่', v.contact.address ?? '']];
    const who = [v.contact.person ? `${v.contact.person}` : '-', v.contact.phone ? `โทร ${v.contact.phone}` : ''].filter(Boolean).join(' ');
    left.push(['ผู้ติดต่อ', who]);
    const lrows = left.flatMap(([k, val]) => wrap(val, 9.5, 300).map((ln, i) => [i === 0 ? k : '', ln, i === 0 && k === lbl] as [string, string, boolean]));
    const right: [string, string][] = [];
    if (v.contact.tax_id) right.push(['เลขผู้เสียภาษี', v.contact.tax_id]);
    right.push(['วันที่', thDate(v.doc.doc_date)]);
    if (credit > 0 && type !== 'QT' && dz.show_credit !== false) right.push(['เครดิต', `${credit} วัน`]);
    if (v.doc.due_date && type !== 'QT' && dz.show_due !== false) right.push(['ครบกำหนด', thDate(v.doc.due_date)]);
    if (full && v.doc.ref_no) right.push(['เลขที่อ้างอิง', v.doc.ref_no]);
    if (full && v.doc.project) right.push(['โปรเจกต์', v.doc.project]);
    if (v.ref) right.push(['อ้างอิง', v.ref.doc_no]);
    if (v.doc.salesperson) right.push(['พนักงานขาย', v.doc.salesperson]);
    const rows = Math.max(lrows.length, right.length), bh = rows * 14 + 14;
    page.drawRectangle({ x: L, y: y - bh, width: R - L, height: bh, borderColor: line, borderWidth: 0.8 });
    lrows.forEach(([k, val, bold], i) => { const yy = y - 15 - i * 14; draw(page, k ? `${k}:` : '', L + 10, yy, 9.5, { bold: true, color: navy }); draw(page, val, L + 52, yy, 9.5, { bold }); });
    right.forEach(([k, val], i) => { const yy = y - 15 - i * 14; draw(page, `${k}:`, 400, yy, 9.5, { bold: true, color: navy }); draw(page, val, R - 10, yy, 9.5, { right: true }); });
    y -= bh + 34;
    return { page, y };
  };
  const X = { no: 56, desc: 78, qty: 322, unit: 350, price: 428, disc: 462, amt: R - 8 };
  const head = (page: PDFPage, y: number) => {
    page.drawRectangle({ x: L, y: y - 9, width: R - L, height: 30, color: navy });
    const hw = { bold: true, color: white };
    draw(page, 'ลำดับ', X.no, y + 3, 9.5, { ...hw, center: true }); draw(page, 'รายละเอียด', X.desc, y + 3, 9.5, hw);
    draw(page, 'จำนวน', X.qty, y + 3, 9.5, { ...hw, right: true }); draw(page, 'หน่วย', X.unit, y + 3, 9.5, { ...hw, center: true });
    draw(page, 'ราคาต่อหน่วย', X.price, y + 3, 9.5, { ...hw, right: true });
    draw(page, 'ส่วนลด', X.disc, y + 9, 9, { ...hw, center: true }); draw(page, full ? '' : '', X.disc, y - 2, 9, hw);
    draw(page, '%', X.disc, y - 3, 9, { ...hw, center: true });
    draw(page, 'จำนวนเงิน (บาท)', X.amt, y + 3, 9.5, { ...hw, right: true });
    return y - 26;
  };
  const sum = docSummary(v);
  const zeroExempt = sum.rows.find(r => r.label.startsWith('มูลค่าที่ไม่มี'))?.value === '0.00';
  const srows = sum.rows.filter(r => !(zeroExempt && r.label.startsWith('มูลค่าที่')));
  const [signL] = SIGNERS[type] ?? ['ผู้รับเอกสาร', ''];
  const leftCap = type === 'QT' ? 'ผู้รับใบเสนอราคา / ผู้มีอำนาจลงนาม' : `${signL} / ผู้มีอำนาจลงนาม`;
  const labels = mode === 'both' ? ['ต้นฉบับ', 'สำเนา'] : [mode === 'copy' ? 'สำเนา' : 'ต้นฉบับ'];
  for (const label of labels) {
    let { page, y } = sheet(label); y = head(page, y);
    for (const l of v.lines) {
      const desc = wrap(l.description + (l.detail ? `\n${l.detail}` : ''), 10, 235);
      const h = Math.max(1, desc.length) * 14 + 10;
      if (y - h < 200) { ({ page, y } = sheet(label)); y = head(page, y); }
      draw(page, String(l.line_no), X.no, y - 4, 10, { center: true });
      desc.forEach((ln, i) => draw(page, ln, X.desc, y - 4 - i * 14, 10));
      draw(page, qtyFmt(l.qty), X.qty, y - 4, 10, { right: true }); draw(page, l.unit ?? '', X.unit, y - 4, 10, { center: true });
      draw(page, fmt(l.unit_price), X.price, y - 4, 10, { right: true });
      const dv = Number(l.discount_value ?? 0), da = Number(l.discount ?? 0);
      draw(page, da > 0 ? (l.discount_type === 'percent' && dv > 0 ? `${qtyFmt(dv)}%` : fmt(da)) : '-', X.disc, y - 4, 10, { center: true });
      draw(page, fmt(l.amount), X.amt, y - 4, 10, { right: true });
      page.drawLine({ start: { x: L, y: y - h + 6 }, end: { x: R, y: y - h + 6 }, thickness: 0.4, color: line });
      y -= h;
    }
    // สรุปยอด (ขวา) + ตัวอักษร/เงื่อนไข (ซ้าย)
    const need = (srows.length + sum.wht.length) * 17 + 190;
    if (y < need) ({ page, y } = sheet(label));
    y -= 8; const top = y; let ly = y;
    draw(page, 'จำนวนเงินรวมทั้งสิ้น (ตัวอักษร): ', L, ly, 9.5, { bold: true, color: navy });
    const pre = width('จำนวนเงินรวมทั้งสิ้น (ตัวอักษร): ', 9.5, true);
    const bt = wrap(bahtText(Number(sum.total)), 9.5, 250 - pre);
    bt.forEach((ln, i) => draw(page, ln, L + pre, ly - i * 12, 9.5)); ly -= bt.length * 12 + 4;
    if (['QT', 'INV'].includes(type) && credit >= 0) {
      const term = credit > 0 ? `ชำระเต็มจำนวน 100% เครดิต ${credit} วัน` : 'ชำระเต็มจำนวน 100% เงินสด/โอนทันที';
      draw(page, 'เงื่อนไขการชำระเงิน: ', L, ly, 9.5, { bold: true, color: navy }); draw(page, term, L + width('เงื่อนไขการชำระเงิน: ', 9.5, true), ly, 9.5); ly -= 14;
    }
    const put = (rs: typeof srows) => rs.forEach(r => {
      if (r.strong) { page.drawLine({ start: { x: 340, y: y + 12 }, end: { x: R, y: y + 12 }, thickness: 1.1, color: navy }); y -= 4; }
      draw(page, r.label, 350, y, r.strong ? 10.5 : 9.5, { bold: r.strong, color: r.strong ? navy : ink });
      draw(page, fmt(r.value), R - 4, y, r.strong ? 10.5 : 9.5, { bold: r.strong, right: true });
      y -= 17;
    });
    put(srows);
    if (sum.wht.length && Number(v.doc.wht_total ?? 0) > 0) { y -= 2; page.drawLine({ start: { x: 340, y: y + 11 }, end: { x: R, y: y + 11 }, thickness: 0.4, color: line }); put(sum.wht); }
    y = Math.min(y, ly) - 4;
    const noteTxt = v.doc.reason || v.doc.note;
    if (full && v.doc.description) { draw(page, 'รายละเอียด', L, y, 9, { bold: true, color: navy }); const dl = wrap(v.doc.description, 9.5, 500); dl.forEach((ln, i) => draw(page, ln, L, y - 12 - i * 12, 9.5)); y -= 12 + dl.length * 12 + 4; }
    if (noteTxt) { draw(page, 'หมายเหตุ', L, y, 9, { bold: true, color: navy }); const nl = wrap(noteTxt, 9.5, 500); nl.forEach((ln, i) => draw(page, ln, L, y - 12 - i * 12, 9.5)); y -= 12 + nl.length * 12 + 4; }
    if (['QT', 'INV', 'BL'].includes(type) && v.payInfo?.length) {
      draw(page, 'ช่องทางการชำระเงิน', L, y, 9, { bold: true, color: navy }); y -= 12;
      for (const p of v.payInfo) {
        const t = p.kind === 'cash' ? 'เงินสด' : p.kind === 'transfer' ? `โอนเงิน ${p.bank ?? ''} ${p.branch ? `สาขา${p.branch} ` : ''}เลขที่บัญชี ${p.account_no ?? ''} ชื่อบัญชี ${p.account_name ?? ''}` : p.kind === 'cheque' ? `เช็คสั่งจ่าย ${p.cheque_payee ?? ''}` : (p.remark ?? '');
        for (const ln of wrap(t.trim(), 9.5, 500)) { draw(page, ln, L, y, 9.5); y -= 12; }
      }
    }
    // ลายเซ็น 3 ช่อง
    if (v.doc.show_signature !== false) {
      if (y < 150) ({ page, y } = sheet(label));
      const sy = Math.max(y - 70, 70);
      page.drawLine({ start: { x: L + 20, y: sy }, end: { x: L + 190, y: sy }, thickness: 0.7, color: ink });
      draw(page, leftCap, L + 105, sy - 13, 9.5, { center: true }); draw(page, 'วันที่ ___/___/______', L + 105, sy - 26, 9.5, { center: true });
      if (stamp) { const k = Math.min(1, 110 / stamp.width, 50 / stamp.height); page.drawImage(stamp, { x: 297 - (stamp.width * k) / 2, y: sy - 4, width: stamp.width * k, height: stamp.height * k }); }
      draw(page, 'ตราประทับบริษัท', 297, sy - 13, 9.5, { center: true });
      const rx = 440;
      if (sig) { const k = Math.min(1, 110 / sig.width, 38 / sig.height); page.drawImage(sig, { x: rx - (sig.width * k) / 2, y: sy + 18, width: sig.width * k, height: sig.height * k }); }
      if (co?.signer_name) draw(page, co.signer_name, rx, sy + 4 + (sig ? 0 : 0), 10.5, { bold: true, center: true, color: navy });
      page.drawLine({ start: { x: rx - 85, y: sy }, end: { x: rx + 85, y: sy }, thickness: 0.7, color: navy });
      if (v.doc.salesperson) { draw(page, v.doc.salesperson, rx, sy - 13, 9.5, { center: true }); draw(page, 'พนักงานขาย', rx, sy - 26, 9.5, { center: true }); }
      else draw(page, 'ผู้มีอำนาจลงนาม', rx, sy - 13, 9.5, { center: true });
    }
    if (v.doc.status === 'cancelled') {
      const wm = 'ยกเลิก', size = 110; let cx = W / 2 - 150, cyy = H / 2 - 60;
      for (const [x2, th] of runs(wm)) { page.drawText(x2, { x: cx, y: cyy, size, font: font(th, true), color: rgb(0.85, 0.2, 0.2), opacity: 0.16, rotate: degrees(24) });
        const adv = font(th, true).widthOfTextAtSize(x2, size); cx += adv * Math.cos(Math.PI * 24 / 180); cyy += adv * Math.sin(Math.PI * 24 / 180); }
    }
  }
  const pages = pdf.getPages();
  pages.forEach((pg, i) => {
    if (dz.form_code) draw(pg, dz.form_code, W / 2, 24, 8, { center: true, color: grey });
    draw(pg, `หน้า ${i + 1} / ${pages.length}`, R, 24, 9, { right: true, color: grey });
  });
  return pdf.save();
}
