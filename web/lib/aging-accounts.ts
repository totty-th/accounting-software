// แยกยอดค้างตามบัญชีคุม (ใช้กระทบกับงบทดลอง)
// ลูกหนี้: ใบเสร็จที่บันทึกแล้วแต่ยังไม่รับเงินอยู่ 11319, ขายสดรอเก็บเงินอยู่ 11319 ทั้งก้อน, ที่เหลืออยู่ 11311
// เจ้าหนี้: ใบรับสินค้า → 21311, ค่าใช้จ่าย → 21399
export const AR_ACCOUNTS = [['11311', 'ลูกหนี้การค้า'], ['11319', 'ใบเสร็จรอเรียกเก็บ']] as const;
export const AP_ACCOUNTS = [['21311', 'เจ้าหนี้การค้า'], ['21399', 'เจ้าหนี้อื่นๆ']] as const;

const r2 = (n: number) => Math.round(n * 100) / 100;

export function splitByAccount(kind: 'ar' | 'ap', r: Record<string, any>): Record<string, number> {
  const out = Number(r.outstanding);
  if (kind === 'ap') return { '21311': r.liability_account === '21311' ? out : 0, '21399': r.liability_account === '21399' ? out : 0 };
  if (r.doc_type === 'CA') return { '11311': 0, '11319': out };
  const pending = Math.min(out, Math.max(0, r2(Number(r.receipted) - Number(r.collected))));
  return { '11311': r2(out - pending), '11319': pending };
}
