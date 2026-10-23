// ตัวช่วยแนะนำจับคู่รายการธนาคาร (statement) กับรายการสมุดบัญชี
// เป็นการ "แนะนำ" เท่านั้น ไม่ลงบัญชีอะไร — การจับคู่จริงทำผ่าน bank_match ที่ตรวจผลรวมที่ฐานข้อมูลอีกชั้น
export type SLine = { id: string; date: string; description: string; amount: number; matched: boolean };
export type SItem = { id: string; date: string; no: string; memo: string; amount: number; matched: boolean };
export type Suggestion = {
  lineIds: string[]; itemIds: string[];
  confidence: 'high' | 'medium' | 'low';
  score: number; reason: string;
};
export type SuggestOpts = { windowDays?: number; maxGroup?: number; maxCandidates?: number };

const cents = (n: number) => Math.round(n * 100);
const dayNo = (iso: string) => Math.floor(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000);
const gap = (a: string, b: string) => Math.abs(dayNo(a) - dayNo(b));

// คำที่ใช้เทียบข้อความ: ตัดตามช่องว่าง/เครื่องหมาย ยาว ≥ 3 ตัวอักษร (ภาษาไทยไม่มีช่องว่างคั่นคำ จึงเทียบแบบ "มีข้อความย่อยตรงกัน" ด้วย)
const tokens = (s: string) => s.toLowerCase().split(/[\s,.;:/()\-_|]+/).filter(t => t.length >= 3);
function textHit(desc: string, memo: string, no: string): boolean {
  const d = desc.toLowerCase(), m = memo.toLowerCase();
  if (no && d.includes(no.toLowerCase())) return true;
  if (tokens(desc).some(t => m.includes(t))) return true;
  if (tokens(memo).some(t => d.includes(t))) return true;
  // ไทย: ข้อความย่อย 4 ตัวอักษรที่ตรงกัน
  for (let i = 0; i + 4 <= d.length && i < 60; i++) if (/[฀-๿]/.test(d[i]) && m.includes(d.slice(i, i + 4))) return true;
  return false;
}

export function suggestMatches(lines: SLine[], items: SItem[], o: SuggestOpts = {}): Suggestion[] {
  const win = o.windowDays ?? 10, maxG = o.maxGroup ?? 4, maxC = o.maxCandidates ?? 14;
  const L = lines.filter(l => !l.matched), I = items.filter(i => !i.matched);
  const out: Suggestion[] = [];
  const usedL = new Set<string>(), usedI = new Set<string>();

  // ---- 1:1 ยอดเท่ากัน ----
  type P = { l: SLine; i: SItem; score: number; text: boolean; d: number };
  const pairs: P[] = [];
  for (const l of L) for (const i of I) {
    if (cents(l.amount) !== cents(i.amount)) continue;
    const d = gap(l.date, i.date); if (d > win) continue;
    const text = textHit(l.description, i.memo, i.no);
    pairs.push({ l, i, d, text, score: 70 - d * 3 + (text ? 25 : 0) });
  }
  const candL = new Map<string, number>(), candI = new Map<string, number>();
  for (const p of pairs) { candL.set(p.l.id, (candL.get(p.l.id) ?? 0) + 1); candI.set(p.i.id, (candI.get(p.i.id) ?? 0) + 1); }
  pairs.sort((a, b) => b.score - a.score || a.d - b.d);
  for (const p of pairs) {
    if (usedL.has(p.l.id) || usedI.has(p.i.id)) continue;
    usedL.add(p.l.id); usedI.add(p.i.id);
    const unique = candL.get(p.l.id) === 1 && candI.get(p.i.id) === 1;
    const confidence = unique && (p.text || p.d <= 3) ? 'high' : (unique && p.d <= 7) || p.text ? 'medium' : 'low';
    out.push({ lineIds: [p.l.id], itemIds: [p.i.id], confidence, score: p.score,
      reason: `ยอดเท่ากัน${p.d === 0 ? ' วันเดียวกัน' : ` ห่างกัน ${p.d} วัน`}${p.text ? ' · ข้อความใกล้เคียง' : ''}${unique ? '' : ' · มีตัวเลือกอื่นยอดเท่ากัน'}` });
  }

  // ---- 1:N และ N:1 (ผลรวมเท่ากัน) ----
  const subsets = <T extends { amount: number }>(pool: T[], target: number): T[][] => {
    const res: T[][] = [];
    const rec = (start: number, cur: T[], sum: number) => {
      if (cur.length >= 2 && sum === target) { res.push([...cur]); return; }
      if (cur.length >= maxG) return;
      for (let k = start; k < pool.length; k++) { cur.push(pool[k]); rec(k + 1, cur, sum + cents(pool[k].amount)); cur.pop(); if (res.length > 1) return; }
    };
    rec(0, [], 0); return res;
  };
  const near = <T extends { date: string }>(pool: T[], date: string) =>
    pool.filter(x => gap(x.date, date) <= win).sort((a, b) => gap(a.date, date) - gap(b.date, date)).slice(0, maxC);
  for (const l of L) {
    if (usedL.has(l.id)) continue;
    const pool = near(I.filter(i => !usedI.has(i.id)), l.date);
    const hit = subsets(pool, cents(l.amount));
    if (hit.length === 0) continue;
    const g = hit[0]; g.forEach(i => usedI.add(i.id)); usedL.add(l.id);
    out.push({ lineIds: [l.id], itemIds: g.map(i => i.id), confidence: hit.length === 1 ? 'medium' : 'low', score: 50 - g.length,
      reason: `รายการธนาคารเดียว = ผลรวมเอกสาร ${g.length} รายการ${hit.length === 1 ? '' : ' · มีชุดอื่นที่ยอดรวมเท่ากัน'}` });
  }
  for (const i of I) {
    if (usedI.has(i.id)) continue;
    const pool = near(L.filter(l => !usedL.has(l.id)), i.date);
    const hit = subsets(pool, cents(i.amount));
    if (hit.length === 0) continue;
    const g = hit[0]; g.forEach(l => usedL.add(l.id)); usedI.add(i.id);
    out.push({ lineIds: g.map(l => l.id), itemIds: [i.id], confidence: hit.length === 1 ? 'medium' : 'low', score: 50 - g.length,
      reason: `เอกสารเดียว = ผลรวมรายการธนาคาร ${g.length} รายการ${hit.length === 1 ? '' : ' · มีชุดอื่นที่ยอดรวมเท่ากัน'}` });
  }
  const rank = { high: 0, medium: 1, low: 2 };
  return out.sort((a, b) => rank[a.confidence] - rank[b.confidence] || b.score - a.score);
}
