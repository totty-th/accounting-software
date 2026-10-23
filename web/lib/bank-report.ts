// งบกระทบยอดธนาคาร ณ วันที่ใดก็ได้ (คำนวณจากข้อมูลปัจจุบัน ไม่ต้องเก็บภาพถ่ายรายเดือน)
// หลักคิด: กลุ่มที่จับคู่แล้วถือว่า "ผ่านธนาคาร ณ วันที่ D" เมื่อรายการธนาคารและเอกสารในกลุ่มลงวันที่ ≤ D ทั้งหมด
// ถ้ามีฝั่งใดลงวันที่หลัง D (เช่น เช็คออก 30 ต.ค. ธนาคารตัด 3 พ.ย.) ณ สิ้น ต.ค. ถือว่ายังไม่กระทบ
export type RLine = { seq: number; date: string; description: string; amount: number; balance: number | null; groupId: string | null };
export type RItem = { date: string; no: string; memo: string; amount: number; groupId: string | null };

const r2 = (n: number) => Math.round(n * 100) / 100;

export function monthEnd(ym: string): string {         // 'YYYY-MM' → 'YYYY-MM-DD' วันสุดท้ายของเดือน
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

export function buildReconcileReport(lines: RLine[], items: RItem[], asOf: string) {
  const L = lines.filter(l => l.date <= asOf).sort((a, b) => a.seq - b.seq);
  const I = items.filter(i => i.date <= asOf);
  // กลุ่มที่ยัง "ไม่ครบ" ณ วันที่นั้น = มีรายการฝั่งใดฝั่งหนึ่งลงวันที่หลังวันที่รายงาน
  const late = new Set<string>();
  for (const l of lines) if (l.groupId && l.date > asOf) late.add(l.groupId);
  for (const i of items) if (i.groupId && i.date > asOf) late.add(i.groupId);
  const open = (g: string | null) => !g || late.has(g);

  const withBal = [...L].reverse().find(l => l.balance !== null);
  const bankBalance = withBal ? withBal.balance! : r2(L.reduce((s, l) => s + l.amount, 0));
  const bookTotal = r2(I.reduce((s, i) => s + i.amount, 0));
  const unItems = I.filter(i => open(i.groupId));
  const unLines = L.filter(l => open(l.groupId));
  const inTransit = unItems.filter(i => i.amount > 0), outstanding = unItems.filter(i => i.amount < 0);
  const sum = (a: { amount: number }[]) => r2(a.reduce((s, x) => s + x.amount, 0));
  const adjBank = r2(bankBalance + sum(inTransit) + sum(outstanding));
  const adjBook = r2(bookTotal + sum(unLines));
  return {
    asOf, bankBalance, bookTotal, inTransit, outstanding, unLines, adjBank, adjBook,
    unexplained: r2(adjBank - adjBook), lineCount: L.length, matchedLines: L.length - unLines.length,
    unmatchedItems: unItems.length, matchedLater: (g: string | null) => !!g && late.has(g),
  };
}
