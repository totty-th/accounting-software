import fs from 'node:fs';
import path from 'node:path';
import { PDFDocument, PDFFont, PDFPage, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { getDb } from './db';
import { bahtText } from './wht-pdf';

export type PKind = 'PO' | 'RI' | 'PAY';
export type PView = {
  kind: PKind; title: string; no: string; date: string; status: string;
  company: { name?: string; address?: string; tax_id?: string } | null;
  party?: { name: string; address?: string; tax_id?: string };
  meta: [string, string][];
  cols: { h: string; right?: boolean; w: number }[]; rows: string[][];
  totals: [string, string, boolean?][]; total?: number; note?: string; signers: [string, string];
};
const COLOR = { PO: rgb(0.16, 0.38, 0.7), RI: rgb(0.1, 0.5, 0.35), PAY: rgb(0.55, 0.3, 0.65) };
const ASSETS = () => { const a = path.join(process.cwd(), 'assets'); return fs.existsSync(a) ? a : path.join(process.cwd(), 'web/assets'); };
const fmt = (n: unknown) => Number(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = (n: unknown) => Number(n ?? 0).toLocaleString('en-US', { maximumFractionDigits: 4 });
const th = (iso: unknown) => { if (!iso) return ''; const [y, m, d] = String(iso).slice(0, 10).split('-'); return `${d}/${m}/${+y + 543}`; };
const isThai = (c: string) => /[฀-๿]/.test(c);
const STATUS: Record<string, string> = { pending: 'รออนุมัติ', approved: 'อนุมัติแล้ว', rejected: 'ไม่อนุมัติ', converted: 'อัปเกรดเป็นใบรับสินค้าแล้ว',
  cancelled: 'ยกเลิก', unpaid: 'รออนุมัติ', paid: 'จ่ายแล้ว', active: 'ใช้งานอยู่' };

export async function loadPurchaseView(kind: PKind, id: string): Promise<PView | null> {
  const db = await getDb();
  const company = (await db.q('select name,address,tax_id from company_profile'))[0] ?? null;
  const party = async (cid: string) => { const c = (await db.q('select coalesce(business_name,contact_name) name,address,tax_id from contacts where id=$1', [cid]))[0]; return c; };
  if (kind === 'PO' || kind === 'RI') {
    const h = (await db.q(kind === 'PO' ? 'select * from purchase_orders where id=$1' : 'select * from goods_receipts where id=$1', [id]))[0];
    if (!h) return null;
    const ls = await db.q(`select l.*, p.code, p.name from ${kind === 'PO' ? 'purchase_order_lines' : 'goods_receipt_lines'} l
      join products p on p.id=l.product_id where ${kind === 'PO' ? 'po_id' : 'ri_id'}=$1 order by line_no`, [id]);
    return { kind, title: kind === 'PO' ? 'ใบสั่งซื้อ' : 'ใบรับสินค้า', no: kind === 'PO' ? h.po_no : h.ri_no, date: kind === 'PO' ? h.po_date : h.ri_date,
      status: h.status, company, party: (await party(h.contact_id)) as PView['party'], meta: h.ref_no ? [['อ้างอิง', h.ref_no]] : [],
      cols: [{ h: '#', w: 22 }, { h: 'สินค้า', w: 220 }, { h: 'จำนวน', right: true, w: 60 }, { h: 'ราคาต่อหน่วย', right: true, w: 80 }, { h: 'VAT', right: true, w: 50 }, { h: 'มูลค่า', right: true, w: 80 }],
      rows: ls.map(l => [String(l.line_no), `${l.code} ${l.name}`, qty(l.qty), fmt(l.unit_price), fmt(l.vat), fmt(l.net)]),
      totals: [['รวมก่อน VAT', fmt(h.subtotal)], ['ภาษีมูลค่าเพิ่ม', fmt(h.vat)], ['ยอดรวมสุทธิ', fmt(h.total), true]], total: +h.total,
      note: h.note ?? undefined, signers: kind === 'PO' ? ['ผู้สั่งซื้อ', 'ผู้อนุมัติ'] : ['ผู้รับสินค้า', 'ผู้อนุมัติ'] };
  }
  const s = (await db.q('select * from payment_slips where id=$1', [id]))[0];
  if (!s) return null;
  const items = await db.q('select * from payment_slip_items where slip_id=$1 order by line_no', [id]);
  const rows: string[][] = []; let tot = 0;
  for (const it of items) {
    const i = (await db.q('select * from slip_doc_info($1,$2)', [it.doc_type, it.doc_id]))[0];
    const c = await party(i.contact_id); tot += +i.net;
    rows.push([String(it.line_no), c?.name ?? '', i.doc_no, th(i.due_date), fmt(i.gross), fmt(i.wht), fmt(i.net)]);
  }
  return { kind, title: 'ใบเตรียมจ่าย', no: s.pay_no, date: s.pay_date, status: s.status, company,
    meta: [...(s.due_date ? [['ครบกำหนด', th(s.due_date)] as [string, string]] : []), ...(s.preparer ? [['ผู้จัดทำ', s.preparer] as [string, string]] : []),
      ...(s.requester ? [['ผู้ขอเบิก', s.requester] as [string, string]] : [])],
    cols: [{ h: '#', w: 22 }, { h: 'ผู้จำหน่าย', w: 150 }, { h: 'เอกสาร', w: 95 }, { h: 'ครบกำหนด', w: 70 }, { h: 'ยอดรวม', right: true, w: 62 }, { h: 'หัก ณ ที่จ่าย', right: true, w: 52 }, { h: 'จ่ายสุทธิ', right: true, w: 60 }],
    rows, totals: [['ยอดจ่ายสุทธิรวม', fmt(tot), true]], total: tot, note: s.reason ?? undefined, signers: ['ผู้จัดทำ', 'ผู้อนุมัติ'] };
}
export async function purchaseIdByToken(token: string): Promise<{ kind: PKind; id: string } | null> {
  const r = (await (await getDb()).q('select kind, id from purchase_doc_by_token($1)', [token]))[0];
  return r ? { kind: r.kind, id: r.id } : null;
}

export async function buildPurchasePdf(v: PView): Promise<Uint8Array> {
  const dir = ASSETS(); const pdf = await PDFDocument.create(); pdf.registerFontkit(fontkit);
  const f = (n: string) => pdf.embedFont(fs.readFileSync(path.join(dir, 'fonts', n)), { subset: true });
  const F = { th: await f('sarabun-thai-400-normal.woff'), la: await f('sarabun-latin-400-normal.woff'),
    thB: await f('sarabun-thai-700-normal.woff'), laB: await f('sarabun-latin-700-normal.woff') };
  const col = COLOR[v.kind], ink = rgb(0.1, 0.1, 0.12), grey = rgb(0.45, 0.45, 0.5);
  const runs = (s: string) => { const o: [string, boolean][] = []; for (const ch of s) { const t = isThai(ch) || ch === '฿'; const l = o[o.length - 1]; if (l && l[1] === t) l[0] += ch; else o.push([ch, t]); } return o; };
  const font = (t: boolean, b: boolean): PDFFont => (t ? (b ? F.thB : F.th) : (b ? F.laB : F.la));
  const width = (s: string, z: number, b = false) => runs(s).reduce((w, [x, t]) => w + font(t, b).widthOfTextAtSize(x, z), 0);
  const draw = (pg: PDFPage, s: string, x: number, y: number, z = 10, o: { bold?: boolean; right?: boolean; color?: any } = {}) => {
    if (!s) return; let cx = o.right ? x - width(s, z, o.bold) : x;
    for (const [x2, t] of runs(s)) { pg.drawText(x2, { x: cx, y, size: z, font: font(t, !!o.bold), color: o.color ?? ink }); cx += font(t, !!o.bold).widthOfTextAtSize(x2, z); }
  };
  const wrap = (s: string, z: number, maxW: number) => { const out: string[] = [];
    for (const para of String(s ?? '').split('\n')) { let line = ''; for (const ch of para) { if (width(line + ch, z) > maxW && line) { out.push(line); line = ch; } else line += ch; } out.push(line); } return out; };
  const L = 42, R = 553, W = 595, H = 842;
  const xs: number[] = []; { let x = L; for (const c of v.cols) { xs.push(x); x += c.w; } }
  const sheet = () => {
    const page = pdf.addPage([W, H]); let y = H - 48;
    page.drawRectangle({ x: 0, y: H - 14, width: W, height: 14, color: col });
    draw(page, v.company?.name ?? '', L, y, 13, { bold: true });
    const a = wrap(v.company?.address ?? '', 9.5, 280); a.forEach((ln, i) => draw(page, ln, L, y - 15 - i * 12, 9.5, { color: grey }));
    if (v.company?.tax_id) draw(page, `เลขประจำตัวผู้เสียภาษี ${v.company.tax_id}`, L, y - 15 - a.length * 12, 9.5, { color: grey });
    draw(page, v.title, R, y, 16, { bold: true, right: true, color: col });
    draw(page, STATUS[v.status] ?? v.status, R, y - 18, 10.5, { right: true, color: grey });
    y -= 78; let cy = y;
    if (v.party) { draw(page, 'ผู้จำหน่าย', L, y, 9, { color: grey }); draw(page, v.party.name, L, y - 13, 11, { bold: true }); cy = y - 27;
      for (const ln of wrap(v.party.address ?? '', 9.5, 270)) { draw(page, ln, L, cy, 9.5); cy -= 12; }
      if (v.party.tax_id) { draw(page, `เลขประจำตัวผู้เสียภาษี ${v.party.tax_id}`, L, cy, 9.5); cy -= 12; } }
    const meta: [string, string][] = [['เลขที่', v.no], ['วันที่', th(v.date)], ...v.meta];
    meta.forEach(([k, val], i) => { draw(page, k, 360, y - i * 14, 10, { color: grey }); draw(page, val, R, y - i * 14, 10, { right: true }); });
    y = Math.min(cy, y - meta.length * 14) - 14;
    page.drawRectangle({ x: L, y: y - 5, width: R - L, height: 20, color: col });
    v.cols.forEach((c, i) => draw(page, c.h, c.right ? xs[i] + c.w - 4 : xs[i] + 4, y, 10, { bold: true, right: c.right, color: rgb(1, 1, 1) }));
    return { page, y: y - 22 };
  };
  let { page, y } = sheet();
  for (const r of v.rows) {
    const wr = r.map((t, i) => (v.cols[i].right ? [t] : wrap(t, 10, v.cols[i].w - 8)));
    const h = Math.max(...wr.map(w => w.length)) * 13 + 6;
    if (y - h < 200) ({ page, y } = sheet());
    wr.forEach((lines, i) => lines.forEach((ln, k) => draw(page, ln, v.cols[i].right ? xs[i] + v.cols[i].w - 4 : xs[i] + 4, y - k * 13, 10, { right: v.cols[i].right })));
    page.drawLine({ start: { x: L, y: y - 8 }, end: { x: R, y: y - 8 }, thickness: 0.4, color: rgb(0.85, 0.85, 0.88) });
    y -= h;
  }
  if (y < v.totals.length * 16 + 150) ({ page, y } = sheet());
  y -= 6;
  if (v.total != null) draw(page, `(${bahtText(v.total)})`, L, y, 10);
  for (const [k, val, strong] of v.totals) {
    draw(page, k, 440, y, strong ? 11 : 10, { bold: !!strong, right: true, color: strong ? col : ink });
    draw(page, `${val} บาท`, R - 6, y, strong ? 11 : 10, { bold: !!strong, right: true }); y -= 15;
  }
  y -= 6;
  if (v.note) { draw(page, 'หมายเหตุ', L, y, 9.5, { color: col }); wrap(v.note, 10, 500).forEach((ln, i) => draw(page, ln, L, y - 13 - i * 12, 10)); }
  const sy = 84;
  [[L, v.signers[0]], [312, v.signers[1]]].forEach(([x, cap]) => {
    const xx = x as number;
    page.drawLine({ start: { x: xx, y: sy + 14 }, end: { x: xx + 138, y: sy + 14 }, thickness: 0.6, color: grey });
    page.drawLine({ start: { x: xx + 148, y: sy + 14 }, end: { x: xx + 238, y: sy + 14 }, thickness: 0.6, color: grey });
    draw(page, cap as string, xx + 69 - width(cap as string, 9.5) / 2, sy, 9.5, { color: grey });
    draw(page, 'วันที่', xx + 193 - width('วันที่', 9.5) / 2, sy, 9.5, { color: grey });
  });
  const pages = pdf.getPages();
  pages.forEach((pg, i) => draw(pg, `หน้า ${i + 1}/${pages.length}`, R, 24, 9, { right: true, color: grey }));
  return pdf.save();
}
