import fs from 'node:fs';
import path from 'node:path';
import { PDFDocument, PDFFont, PDFPage, rgb, degrees } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { DOC_TITLE, type DocView } from './doc-view';
import { bahtText } from './wht-pdf';
import { docSummary, isFull, lineTaxLabel, lineWhtLabel, shipRows, SIGNERS } from './doc-calc';

const ASSETS = () => { const a = path.join(process.cwd(), 'assets'); return fs.existsSync(a) ? a : path.join(process.cwd(), 'web/assets'); };
const fmt = (n: unknown) => Number(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtyFmt = (n: unknown) => Number(n ?? 0).toLocaleString('en-US', { maximumFractionDigits: 4 });
const thDate = (iso: string) => { const [y, m, d] = iso.slice(0, 10).split('-'); return `${d}/${m}/${+y + 543}`; };
const isThai = (c: string) => /[฀-๿]/.test(c);

export type PdfMode = 'original' | 'copy' | 'both';

export type PdfKind = 'doc' | 'delivery';

// kind='delivery' = ใบส่งของ: ไม่มีราคา (#/รายละเอียด/จำนวน) + บล็อกข้อมูลจัดส่ง (ตาม FlowAccount + ส่วนเพิ่มของเรา)
export async function buildDocPdf(v: DocView, mode: PdfMode = 'original', kind: PdfKind = 'doc'): Promise<Uint8Array> {
  const dlv = kind === 'delivery';
  const qt = v.doc.doc_type === 'QT', full = isFull(v), showTax = v.doc.doc_type !== 'BL';
  const dir = ASSETS();
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const f = (n: string) => pdf.embedFont(fs.readFileSync(path.join(dir, 'fonts', n)), { subset: true });
  const F = { th: await f('sarabun-thai-400-normal.woff'), la: await f('sarabun-latin-400-normal.woff'),
              thB: await f('sarabun-thai-700-normal.woff'), laB: await f('sarabun-latin-700-normal.woff') };
  const t = dlv ? { title: 'ใบส่งของ', rgb: [0.18, 0.49, 0.43] as [number, number, number] } : DOC_TITLE[v.doc.doc_type], dz = v.design, col = dz?.bw && !dlv ? rgb(0.15, 0.15, 0.15) : rgb(...t.rgb), ink = rgb(0.1, 0.1, 0.12), grey = rgb(0.45, 0.45, 0.5);

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

  const emb = async (s?: string | null) => { if (!s) return null; const m = /^data:image\/(png|jpeg);base64,(.+)$/.exec(s); if (!m) return null;
    try { const b = Buffer.from(m[2], 'base64'); return m[1] === 'png' ? await pdf.embedPng(b) : await pdf.embedJpg(b); } catch { return null; } };
  const logoImg = dz?.logo !== false ? await emb(v.images?.logo) : null, stampImg = dz?.stamp !== false ? await emb(v.images?.stamp) : null;
  // กระดาษต่อเนื่องของ FA = 612x792 pt (8.5x11 นิ้ว, อ่านจาก MediaBox ของ PDF ตัวอย่าง FA 4-11-2026) · A4 = 595x842
  const cont = dz?.paper === 'continuous'; const L = 42, R = 553, W = cont ? 612 : 595, H = cont ? 792 : 842;
  const sheet = (label: string) => {
    let page = pdf.addPage([W, H]); let y = H - 48;
    page.drawRectangle({ x: 0, y: H - 14, width: W, height: 14, color: col });
    // หัว: บริษัท (ซ้าย) / ชื่อเอกสาร (ขวา)
    const lk = logoImg ? Math.min(1, 150 / logoImg.width, 40 / logoImg.height) : 0;
    if (logoImg && !dlv) { page.drawImage(logoImg, { x: L, y: y - logoImg.height * lk + 10, width: logoImg.width * lk, height: logoImg.height * lk }); y -= logoImg.height * lk + 4; }
    // คอลัมน์ซ้าย (บริษัท กว้าง 285) / คอลัมน์ขวา (ชื่อเอกสาร กว้าง 205) — ตัดบรรทัดตามความกว้างจริงของตัวหนา ไม่ให้ทับกัน
    const LW = 285, RW = 205;
    const wrapB = (s: string, size: number, maxW: number, bold: boolean, seps: RegExp) => {
      const out: string[] = []; let cur = '';
      const flush = () => { if (cur) { out.push(cur); cur = ''; } };
      for (const tok of s.split(seps)) {
        if (cur && width(cur + tok, size, bold) > maxW) flush();
        if (width(tok, size, bold) > maxW) { for (const ch of tok) { if (cur && width(cur + ch, size, bold) > maxW) flush(); cur += ch; } } else cur += tok;
      } flush(); return out; };
    const nameL = wrapB(v.company?.name ?? '', 13, LW, true, /(?<=[ )])/);
    const addrL = wrap(v.company?.address ?? '', 9.5, LW);
    const taxL = v.company?.tax_id ? [`เลขประจำตัวผู้เสียภาษี ${v.company.tax_id}`] : [];
    let cy0 = y; nameL.forEach(ln => { draw(page, ln, L, cy0, 13, { bold: true }); cy0 -= 16; });
    cy0 += 2; [...addrL, ...taxL].forEach(ln => { cy0 -= 12; draw(page, ln, L, cy0, 9.5, { color: grey }); });
    const ttl = wrapB((!dlv && dz?.title) || t.title, 15, RW, true, /(?<=[\/)])|(?<= )/);
    let ry = y; ttl.forEach(ln => { draw(page, ln, R, ry, 15, { bold: true, right: true, color: col }); ry -= 19; });
    if (dlv || dz?.copy_mark !== false) { draw(page, label, R, ry + 1, 10.5, { right: true, color: grey }); ry -= 14; }
    y = Math.min(cy0, ry) - 26;
    // ลูกค้า + เลขที่/วันที่
    draw(page, (!dlv && dz?.customer_label) || 'ลูกค้า', L, y, 9, { color: grey });
    draw(page, v.contact.name, L, y - 13, 11, { bold: true });
    let cy = y - 30;
    for (const ln of wrap(v.contact.address ?? '', 9.5, 270)) { draw(page, ln, L, cy, 9.5); cy -= 15; }
    if (v.contact.tax_id) { draw(page, `เลขประจำตัวผู้เสียภาษี ${v.contact.tax_id}`, L, cy, 9.5); cy -= 15; }
    const meta: [string, string][] = [['เลขที่', v.doc.doc_no], ['วันที่', v.doc.doc_type === 'INV' && full && v.doc.term_mode === 'credit_nodate' ? '................................' : thDate(v.doc.doc_date)]];
    const nodate = v.doc.doc_type === 'INV' && full && v.doc.term_mode === 'credit_nodate';
    const credit = full ? (v.doc.term_mode === 'cash' || nodate ? 0 : Number(v.doc.credit_days ?? 0)) : v.contact.credit_days;
    if (credit > 0 && !dlv && dz?.show_credit !== false) meta.push(['เครดิต', `${credit} วัน`]);
    if (v.doc.due_date && !qt && !nodate && !dlv && dz?.show_due !== false) meta.push(['ครบกำหนด', thDate(v.doc.due_date)]);
    if (full && v.doc.ref_no) meta.push(['เลขที่อ้างอิง', v.doc.ref_no]);
    if (full && v.doc.project) meta.push(['โปรเจกต์', v.doc.project]);
    if (v.doc.salesperson) meta.push(['พนักงานขาย', v.doc.salesperson]);
    if (v.ref && !dlv && (v.doc.doc_type === 'CN' || v.doc.doc_type === 'DN')) meta.push(['วันที่อ้างอิง', thDate(v.ref.doc_date)]);
    if (v.ref && !dlv) meta.push(['อ้างอิง', v.ref.doc_no]);
    meta.forEach(([k, val], i) => { draw(page, k, 360, y - i * 18, 10, { color: grey }); draw(page, val, R, y - i * 18, 10, { right: true }); });
    y = Math.min(cy, y - meta.length * 18) - 20;
    if (dlv) {   // บล็อกข้อมูลจัดส่ง
      const sr = shipRows(v);
      if (sr.length) {
        const lines = sr.flatMap(([k, val]) => wrap(val, 10, 400).map((ln, i) => [i === 0 ? k : '', ln] as [string, string]));
        const bh = lines.length * 13 + 12;
        page.drawRectangle({ x: L, y: y - bh + 8, width: R - L, height: bh, borderColor: rgb(0.8, 0.8, 0.84), borderWidth: 0.6 });
        lines.forEach(([k, ln], i) => { draw(page, k, L + 8, y - 4 - i * 13, 10, { color: grey }); draw(page, ln, L + 100, y - 4 - i * 13, 10); });
        y -= bh + 10;
      }
    }
    return { page, y };
  };
  const tableHead = (page: PDFPage, y: number) => {
    page.drawRectangle({ x: L, y: y - 7, width: R - L, height: 24, color: col });
    const w = rgb(1, 1, 1);
    draw(page, '#', L + 6, y, 10, { bold: true, color: w }); draw(page, 'รายละเอียด', L + 28, y, 10, { bold: true, color: w });
    if (dlv) { draw(page, 'จำนวน', R - 6, y, 10, { bold: true, color: w, right: true }); return y - 28; }
    draw(page, 'จำนวน', 300, y, 10, { bold: true, color: w, right: true });
    draw(page, 'ราคาต่อหน่วย', full ? 366 : 372, y, 10, { bold: true, color: w, right: true });
    if (full) draw(page, 'ส่วนลด', 410, y, 10, { bold: true, color: w, right: true });
    if (showTax) { draw(page, 'ภาษี', full ? 445 : 414, y, 10, { bold: true, color: w, right: true }); draw(page, 'หัก ณ ที่จ่าย', full ? 498 : 482, y, 10, { bold: true, color: w, right: true }); }
    draw(page, 'มูลค่า', R - 6, y, 10, { bold: true, color: w, right: true });
    return y - 28;
  };

  const sum = docSummary(v);
  const [signL, signR] = dlv ? ['ผู้รับสินค้า', 'ผู้ส่งสินค้า'] : SIGNERS[v.doc.doc_type];
  const labels = mode === 'both' ? ['ต้นฉบับ', 'สำเนา'] : [mode === 'copy' ? 'สำเนา' : 'ต้นฉบับ'];
  for (const label of labels) {
    let { page, y } = sheet(label);
    y = tableHead(page, y);
    for (const l of v.lines) {
      const desc = wrap(l.description + (l.detail ? `\n${l.detail}` : ''), 10, dlv ? 400 : 230);
      const h = Math.max(1, desc.length) * 16 + 12;
      if (y - h < 210) { ({ page, y } = sheet(label)); y = tableHead(page, y); }
      draw(page, String(l.line_no), L + 6, y, 10);
      desc.forEach((ln, i) => draw(page, ln, L + 28, y - i * 16, 10));
      if (dlv) draw(page, qtyFmt(l.qty) + (l.unit ? ` ${l.unit}` : ''), R - 6, y, 10, { right: true });
      else { draw(page, qtyFmt(l.qty) + (l.unit ? ` ${l.unit}` : ''), 300, y, 10, { right: true }); draw(page, fmt(l.unit_price), full ? 366 : 372, y, 10, { right: true });
      if (full && Number(l.discount) > 0) draw(page, fmt(l.discount), 410, y, 10, { right: true });
      if (showTax) { draw(page, lineTaxLabel(v, l), full ? 445 : 414, y, 10, { right: true }); draw(page, lineWhtLabel(v, l), full ? 498 : 482, y, 10, { right: true }); }
      draw(page, fmt(l.amount), R - 6, y, 10, { right: true }); }
      page.drawLine({ start: { x: L, y: y - h + 20 }, end: { x: R, y: y - h + 20 }, thickness: 0.4, color: rgb(0.85, 0.85, 0.88) });
      y -= h;
    }
    // สรุปยอด
    if (dlv) { if (y < 170) ({ page, y } = sheet(label)); draw(page, `จำนวน ${v.lines.length} รายการ`, L, y - 4, 10, { color: grey }); }
    else {
    const need = (sum.rows.length + sum.wht.length) * 19 + 170;
    if (y < need) ({ page, y } = sheet(label));
    y -= 6;
    draw(page, `(${bahtText(Number(sum.total))})`, L, y - (sum.rows.length * 19) / 2, 10);
    const put = (rows: typeof sum.rows) => rows.forEach(r => {
      if (r.gap) y -= 5;
      draw(page, r.label, 440, y, r.strong ? 11 : 10, { bold: r.strong, right: true, color: r.strong ? col : ink });
      draw(page, `${fmt(r.value)} บาท`, R - 6, y, r.strong ? 11 : 10, { bold: r.strong, right: true });
      y -= 19;
    });
    put(sum.rows);
    if (sum.wht.length) { y -= 4; page.drawLine({ start: { x: 330, y: y + 10 }, end: { x: R, y: y + 10 }, thickness: 0.4, color: rgb(0.8, 0.8, 0.84) }); put(sum.wht); }
    y -= 6;
    const noteTxt = v.doc.reason || v.doc.note;
    if (full && v.doc.description) { draw(page, 'รายละเอียด', L, y, 9.5, { color: col }); const dl = wrap(v.doc.description, 10, 500); dl.forEach((ln, i) => draw(page, ln, L, y - 13 - i * 12, 10)); y -= 13 + dl.length * 12 + 4; }
    if (noteTxt) { const nl = wrap(noteTxt, 10, 500); draw(page, 'หมายเหตุ', L, y, 9.5, { color: col }); nl.forEach((ln, i) => draw(page, ln, L, y - 13 - i * 12, 10)); y -= 13 + nl.length * 12 + 4; }
    // ช่องทางการชำระเงิน (ตั้งที่ ตั้งค่า → ข้อมูลการรับชำระ) เฉพาะเอกสารที่รอรับเงิน และเหลือที่ว่างเหนือช่องลายเซ็น
    if (['QT', 'INV', 'BL'].includes(v.doc.doc_type) && v.payInfo?.length && y > 160) {
      draw(page, 'ช่องทางการชำระเงิน', L, y, 9.5, { color: col }); y -= 13;
      for (const p of v.payInfo) {
        const t = (p.kind === 'cash' ? 'เงินสด' : p.kind === 'transfer' ? `โอนเงิน ${p.bank ?? ''} ${p.branch ? `สาขา${p.branch} ` : ''}เลขที่บัญชี ${p.account_no ?? ''} ชื่อบัญชี ${p.account_name ?? ''}` : `เช็คสั่งจ่ายในนาม ${p.cheque_payee ?? ''}`) + (p.remark ? ` (${p.remark})` : '');
        for (const ln of wrap(t, 10, 500)) { if (y < 150) break; draw(page, ln, L, y, 10); y -= 12; }
      }
    }
    }
    // ลายเซ็น (ในนาม + ช่องเซ็น + วันที่)
    const sy = 84;
    if (dlv || v.doc.show_signature !== false) [[L, signL, v.contact.name], [312, signR, v.company?.name ?? '']].forEach(([x, cap, who]) => {
      const xx = x as number;
      draw(page, `ในนาม ${who}`, xx, sy + 52, 9.5, { color: grey });
      if (!dlv && stampImg && xx > 300) { const k = Math.min(1, 90 / stampImg.width, 56 / stampImg.height); page.drawImage(stampImg, { x: xx + 40, y: sy + 16, width: stampImg.width * k, height: stampImg.height * k, opacity: 0.9 }); }
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
